import { existsSync, readdirSync, readFileSync } from "node:fs"
import { extname, resolve } from "node:path"
import type { IntegrationCredentials, IntegrationRecord } from "../db/schema"
import { normalizeInboundPayloadToCases } from "../ingest/normalize-upload"
import type { AccountingPaymentApplication, SettlementCase, SourceRef } from "../types"
import { parseDecimalStringToMinor } from "../money"
import { assertProviderEndpointHostAllowed, assertProviderEndpointResolvesPublicly, fetchProvider, validateProviderEndpointUrl } from "./http"

export interface ConnectorFetchResult {
	recordsFetched: number
	cases: SettlementCase[]
	rawPayload?: string
	warnings?: string[]
}

const MAX_PROVIDER_SYNC_PAGES = 100
const STRIPE_PAGE_SIZE = 100
const WISE_PAGE_SIZE = 100
const ACCOUNTING_PAGE_SIZE = 1000
const LINKED_INVOICE_LOOKUP_BATCH_SIZE = 40
const MAX_LINKED_INVOICE_LOOKUP_BATCHES = 20
const SYNC_CURSOR_OVERLAP_MS = 5 * 60 * 1000

function accountingPaymentGap(providerName: string, applications: AccountingPaymentApplication[]): string {
	if (applications.length === 0) {
		return `${providerName} invoice evidence was fetched, but no linked accounting payment application was fetched. The zero-value unmatched wire is structural only and is not evidence that no payment occurred.`
	}
	const mapped = applications.filter((application) => application.amount)
	const note = applications.some((application) => application.mappingIssue)
		? " Some linked records could not be allocated safely and are shown with a mapping issue."
		: ""
	return `${applications.length} linked ${providerName} accounting payment application(s) were fetched (${mapped.length} with an allocated amount). These ledger records do not independently confirm bank settlement or bank fees; the zero-value wire remains structural only.${note}`
}

function xeroPaymentDate(value?: string): string | undefined {
	if (!value) return undefined
	const isoDate = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
	if (isoDate) return providerDate(isoDate)
	const timestamp = value.match(/^\/Date\((\d+)/)?.[1]
	if (!timestamp) return undefined
	const date = new Date(Number(timestamp))
	return Number.isNaN(date.valueOf()) ? undefined : date.toISOString().slice(0, 10)
}

function providerDate(value?: string): string | undefined {
	const date = value?.match(/^\d{4}-\d{2}-\d{2}/)?.[0]
	if (!date) return undefined
	const parsed = new Date(`${date}T00:00:00.000Z`)
	return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date ? date : undefined
}

function existingAccountingInvoiceCases(
	cases: SettlementCase[],
	field: "quickbooks.invoice" | "xero.invoice",
): Map<string, SettlementCase> {
	const byInvoiceId = new Map<string, SettlementCase>()
	for (const settlementCase of cases) {
		const invoiceRef = settlementCase.invoice?.sourceRefs?.find((sourceRef) => sourceRef.field === field)
		if (invoiceRef) byInvoiceId.set(invoiceRef.recordId, settlementCase)
	}
	return byInvoiceId
}

function mergeAccountingPaymentApplications(
	existing: AccountingPaymentApplication[] | undefined,
	updates: AccountingPaymentApplication[],
): { applications: AccountingPaymentApplication[]; truncated: boolean } {
	const byId = new Map((existing ?? []).map((application) => [application.applicationId, application]))
	for (const application of updates) byId.set(application.applicationId, application)
	const merged = [...byId.values()]
	return { applications: merged.slice(-1000), truncated: merged.length > 1000 }
}

function syncSince(lastSuccessfulSyncAt?: string): Date | undefined {
	if (!lastSuccessfulSyncAt) return undefined
	const timestamp = Date.parse(lastSuccessfulSyncAt)
	if (!Number.isFinite(timestamp)) throw new Error("Stored provider sync cursor is not a valid timestamp.")
	return new Date(timestamp - SYNC_CURSOR_OVERLAP_MS)
}

function combineRawPages(pages: string[]): string {
	return pages.length === 1 ? pages[0]! : JSON.stringify({ pageResponses: pages })
}

function authHeader(credentials: IntegrationCredentials): string {
	const token = credentials.accessToken || credentials.apiKey
	if (!token) {
		throw new Error("Missing API token or OAuth access token for this integration.")
	}
	return `Bearer ${token}`
}

async function fetchStripeCases(credentials: IntegrationCredentials, lastSuccessfulSyncAt?: string): Promise<ConnectorFetchResult> {
	const payouts: Array<{
			id: string
			amount: number
			currency: string
			arrival_date: number
			created: number
			description?: string
			status?: string
		}> = []
	const rawPages: string[] = []
	let startingAfter: string | undefined
	const since = syncSince(lastSuccessfulSyncAt)
	for (let page = 0; page < MAX_PROVIDER_SYNC_PAGES; page += 1) {
		const url = new URL("https://api.stripe.com/v1/payouts")
		url.searchParams.set("limit", String(STRIPE_PAGE_SIZE))
		if (since) url.searchParams.set("created[gte]", String(Math.floor(since.getTime() / 1000)))
		if (startingAfter) url.searchParams.set("starting_after", startingAfter)
		const res = await fetchProvider(url, { headers: { Authorization: authHeader(credentials) } })
		if (!res.ok) throw new Error(`Stripe API error (${res.status}): ${(await res.text()).slice(0, 200)}`)
		const rawPage = await res.text()
		rawPages.push(rawPage)
		const payload = JSON.parse(rawPage) as {
			data?: Array<{
				id: string
				amount: number
				currency: string
				arrival_date: number
				created: number
				description?: string
				status?: string
			}>
			has_more?: boolean
		}
		const pagePayouts = payload.data ?? []
		payouts.push(...pagePayouts)
		if (!payload.has_more) break
		const lastId = pagePayouts.at(-1)?.id
		if (!lastId) throw new Error("Stripe indicated another page but returned no payout cursor.")
		startingAfter = lastId
		if (page === MAX_PROVIDER_SYNC_PAGES - 1) throw new Error(`Stripe payout sync exceeded the ${MAX_PROVIDER_SYNC_PAGES}-page safety limit.`)
	}
	const cases: SettlementCase[] = payouts.map((p) => {
		const ccy = p.currency.toUpperCase()
		const valueDate = new Date((p.arrival_date || p.created) * 1000).toISOString().slice(0, 10)
		return {
			caseId: `STRIPE-${p.id}`,
			title: `Stripe Payout ${p.id}`,
			channelLabel: "Stripe Payouts API",
			settlementEvidence: "incomplete",
			evidenceGap: "Payout evidence was fetched, but no independent invoice or contract was matched.",
			createdAt: new Date().toISOString(),
			wire: {
				wireId: p.id,
				transactionRef: p.id,
				format: "platform_payout",
				platformName: "stripe",
				valueDate,
				settledAmount: { amountMinor: p.amount, currency: ccy },
				chargeBearer: "SHA",
				senderCharges: [],
				receiverCharges: [],
				remittanceInfo: p.description || p.id,
				sourceRefs: [
					{
						sourceType: "platform_csv",
						recordId: p.id,
						field: "stripe.payout",
						rawExcerpt: JSON.stringify(p),
					},
				],
			},
		}
	})
	return { recordsFetched: payouts.length, cases, rawPayload: combineRawPages(rawPages) }
}

async function fetchWiseCases(
	credentials: IntegrationCredentials,
	config: Record<string, string>,
): Promise<ConnectorFetchResult> {
	const headers = { Authorization: authHeader(credentials) }
	let profileId: string | undefined = config.profileId?.trim() || undefined
	const rawPages: string[] = []

	if (!profileId) {
		const pRes = await fetchProvider("https://api.transferwise.com/v1/profiles", { headers })
		if (!pRes.ok) {
			throw new Error(`Wise Profiles API error (${pRes.status}): ${(await pRes.text()).slice(0, 200)}`)
		}
		const rawProfiles = await pRes.text()
		rawPages.push(rawProfiles)
		const profiles = JSON.parse(rawProfiles) as Array<{ id: number }>
		profileId = profiles[0]?.id ? String(profiles[0].id) : undefined
	}

	if (!profileId) {
		return { recordsFetched: 0, cases: [] }
	}

	const transfers: Array<{
		id: number
		sourceCurrency: string
		sourceValue: number
		targetCurrency: string
		targetValue: number
		rate: number
		created: string
		reference?: string
	}> = []
	for (let page = 0; page < MAX_PROVIDER_SYNC_PAGES; page += 1) {
		const url = new URL("https://api.transferwise.com/v1/transfers")
		url.searchParams.set("profile", profileId)
		url.searchParams.set("limit", String(WISE_PAGE_SIZE))
		url.searchParams.set("offset", String(page * WISE_PAGE_SIZE))
		const tRes = await fetchProvider(url, { headers })
		if (!tRes.ok) throw new Error(`Wise Transfers API error (${tRes.status}): ${(await tRes.text()).slice(0, 200)}`)
		const rawPage = await tRes.text()
		rawPages.push(rawPage)
		const pageTransfers = JSON.parse(rawPage) as typeof transfers
		transfers.push(...pageTransfers)
		if (pageTransfers.length < WISE_PAGE_SIZE) break
		if (page === MAX_PROVIDER_SYNC_PAGES - 1) throw new Error(`Wise transfer sync exceeded the ${MAX_PROVIDER_SYNC_PAGES}-page safety limit.`)
	}

	const cases: SettlementCase[] = transfers.map((t) => ({
		caseId: `WISE-${t.id}`,
		title: `Wise Transfer #${t.id} (${t.sourceCurrency} → ${t.targetCurrency})`,
		channelLabel: "Wise Transfers API",
		settlementEvidence: "incomplete",
		evidenceGap: "Transfer evidence was fetched, but no independent invoice or contract was matched.",
		createdAt: new Date().toISOString(),
		wire: {
			wireId: String(t.id),
			transactionRef: String(t.id),
			format: "platform_payout",
			platformName: "wise",
			valueDate: t.created.slice(0, 10),
			instructedAmount: { amountMinor: parseDecimalStringToMinor(String(t.sourceValue), t.sourceCurrency), currency: t.sourceCurrency.toUpperCase() },
			settledAmount: { amountMinor: parseDecimalStringToMinor(String(t.targetValue), t.targetCurrency), currency: t.targetCurrency.toUpperCase() },
			bankAppliedRate: t.rate,
			chargeBearer: "SHA",
			senderCharges: [],
			receiverCharges: [],
			remittanceInfo: t.reference || `WISE-${t.id}`,
			sourceRefs: [
				{
					sourceType: "platform_csv",
					recordId: String(t.id),
					field: "wise.transfer",
					rawExcerpt: JSON.stringify(t),
				},
			],
		},
	}))

	return { recordsFetched: transfers.length, cases, rawPayload: combineRawPages(rawPages) }
}

async function fetchQuickBooksCases(
	credentials: IntegrationCredentials,
	config: Record<string, string>,
	lastSuccessfulSyncAt?: string,
	existingCases: SettlementCase[] = [],
): Promise<ConnectorFetchResult> {
	const realmId = config.realmId?.trim()
	if (!realmId) {
		throw new Error("QuickBooks integration requires a Company Realm ID.")
	}
	const invoices: Array<{
		Id: string
		DocNumber?: string
		TotalAmt: number
		TxnDate?: string
		MetaData?: { LastUpdatedTime?: string }
		CurrencyRef?: { value?: string }
		CustomerRef?: { name?: string }
	}> = []
	const payments: Array<{
		Id: string
		TxnDate?: string
		CurrencyRef?: { value?: string }
		TxnStatus?: string
		Line?: Array<{
			Amount?: number
			LinkedTxn?: Array<{ TxnId?: string; TxnType?: string }>
		}>
	}> = []
	const rawPages: string[] = []
	const since = syncSince(lastSuccessfulSyncAt)
	const fetchQuickBooksPages = async <T,>(entity: "Invoice" | "Payment", target: T[]) => {
		for (let page = 0; page < MAX_PROVIDER_SYNC_PAGES; page += 1) {
			const startPosition = page * ACCOUNTING_PAGE_SIZE + 1
			const modifiedFilter = since ? ` WHERE MetaData.LastUpdatedTime > '${since.toISOString()}'` : ""
			const query = encodeURIComponent(`SELECT * FROM ${entity}${modifiedFilter} ORDERBY MetaData.LastUpdatedTime DESC STARTPOSITION ${startPosition} MAXRESULTS ${ACCOUNTING_PAGE_SIZE}`)
			const res = await fetchProvider(`https://quickbooks.api.intuit.com/v3/company/${encodeURIComponent(realmId)}/query?query=${query}`, {
				headers: { Authorization: authHeader(credentials), Accept: "application/json" },
			})
			if (!res.ok) throw new Error(`QuickBooks ${entity} API error (${res.status}): ${(await res.text()).slice(0, 200)}`)
			const rawPage = await res.text()
			rawPages.push(rawPage)
			const json = JSON.parse(rawPage) as { QueryResponse?: Record<string, T[]> }
			const pageRecords = json.QueryResponse?.[entity] ?? []
			target.push(...pageRecords)
			if (pageRecords.length < ACCOUNTING_PAGE_SIZE) break
			if (page === MAX_PROVIDER_SYNC_PAGES - 1) throw new Error(`QuickBooks ${entity.toLowerCase()} sync exceeded the ${MAX_PROVIDER_SYNC_PAGES}-page safety limit.`)
		}
	}
	await fetchQuickBooksPages("Invoice", invoices)
	await fetchQuickBooksPages("Payment", payments)
	const priorCasesByInvoice = existingAccountingInvoiceCases(existingCases, "quickbooks.invoice")
	const linkedInvoiceIds = [...new Set(payments.flatMap((payment) =>
		(payment.Line ?? []).flatMap((line) =>
			(line.LinkedTxn ?? []).filter((linked) => linked.TxnType === "Invoice" && linked.TxnId).map((linked) => linked.TxnId!),
		),
	))]
	const currentInvoiceIds = new Set(invoices.map((invoice) => invoice.Id))
	const missingInvoiceIds = linkedInvoiceIds.filter((id) => !currentInvoiceIds.has(id) && !priorCasesByInvoice.has(id))
	for (let offset = 0; offset < missingInvoiceIds.length && offset / LINKED_INVOICE_LOOKUP_BATCH_SIZE < MAX_LINKED_INVOICE_LOOKUP_BATCHES; offset += LINKED_INVOICE_LOOKUP_BATCH_SIZE) {
		const batch = missingInvoiceIds.slice(offset, offset + LINKED_INVOICE_LOOKUP_BATCH_SIZE)
		const idList = batch.map((id) => `'${id.replace(/'/g, "''")}'`).join(", ")
		const query = encodeURIComponent(`SELECT * FROM Invoice WHERE Id IN (${idList})`)
		const res = await fetchProvider(`https://quickbooks.api.intuit.com/v3/company/${encodeURIComponent(realmId)}/query?query=${query}`, {
			headers: { Authorization: authHeader(credentials), Accept: "application/json" },
		})
		if (!res.ok) throw new Error(`QuickBooks linked invoice lookup error (${res.status}): ${(await res.text()).slice(0, 200)}`)
		const rawPage = await res.text()
		rawPages.push(rawPage)
		const json = JSON.parse(rawPage) as { QueryResponse?: { Invoice?: typeof invoices } }
		invoices.push(...(json.QueryResponse?.Invoice ?? []))
	}
	const invoicesById = new Map(invoices.map((invoice) => [invoice.Id, invoice]))
	const foundInvoiceIds = new Set(invoices.map((invoice) => invoice.Id))
	const unresolvedInvoiceCount = linkedInvoiceIds.filter((id) => !foundInvoiceIds.has(id) && !priorCasesByInvoice.has(id)).length
	const applicationsByInvoice = new Map<string, AccountingPaymentApplication[]>()
	const truncatedPaymentApplications = new Set<string>()
	for (const payment of payments) {
		for (const [lineIndex, line] of (payment.Line ?? []).entries()) {
			const linkedInvoices = (line.LinkedTxn ?? []).filter((linked) => linked.TxnType === "Invoice" && linked.TxnId)
			for (const linked of linkedInvoices) {
				const invoice = invoicesById.get(linked.TxnId!)
				const priorCase = priorCasesByInvoice.get(linked.TxnId!)
				if (!invoice && !priorCase) continue
				const invoiceCurrency = (invoice?.CurrencyRef?.value || priorCase?.invoice?.expectedAmount.currency || "USD").toUpperCase()
				const paymentCurrency = (payment.CurrencyRef?.value || invoiceCurrency).toUpperCase()
				const mappingIssue = linkedInvoices.length > 1
					? "This QuickBooks payment line links to multiple invoice records; its amount cannot be allocated to one invoice safely."
					: paymentCurrency !== invoiceCurrency
						? `Payment currency ${paymentCurrency} differs from invoice currency ${invoiceCurrency}; the amount was not converted or allocated.`
						: typeof line.Amount !== "number" || !Number.isFinite(line.Amount)
							? "QuickBooks did not provide a valid payment line amount."
							: undefined
				const sourceRef: SourceRef = {
					sourceType: "platform_csv",
					recordId: payment.Id,
					field: `quickbooks.payment.Line[${lineIndex}]`,
					rawExcerpt: JSON.stringify({ paymentId: payment.Id, txnDate: payment.TxnDate, amount: line.Amount, currency: paymentCurrency, linkedTxn: linkedInvoices }),
				}
				const application: AccountingPaymentApplication = {
					provider: "quickbooks",
					applicationId: `${payment.Id}:${lineIndex}:${linked.TxnId}`,
					paymentId: payment.Id,
					invoiceRecordId: linked.TxnId!,
					date: providerDate(payment.TxnDate),
					amount: !mappingIssue ? { amountMinor: parseDecimalStringToMinor(String(line.Amount), invoiceCurrency), currency: invoiceCurrency } : undefined,
					status: payment.TxnStatus,
					mappingIssue,
					sourceRef,
				}
				const current = applicationsByInvoice.get(linked.TxnId!) ?? []
				if (current.length < 1000) current.push(application)
				else truncatedPaymentApplications.add(linked.TxnId!)
				applicationsByInvoice.set(linked.TxnId!, current)
			}
		}
	}
	const cases: SettlementCase[] = invoices.map((inv) => {
		const ccy = (inv.CurrencyRef?.value || "USD").toUpperCase()
		const minor = parseDecimalStringToMinor(String(inv.TotalAmt), ccy)
		const priorCase = priorCasesByInvoice.get(inv.Id)
		const merged = mergeAccountingPaymentApplications(priorCase?.accountingPayments, applicationsByInvoice.get(inv.Id) ?? [])
		const accountingPayments = merged.applications
		return {
			caseId: `QBO-${inv.DocNumber || inv.Id}`,
			title: `QuickBooks Invoice ${inv.DocNumber || inv.Id}`,
			channelLabel: "QuickBooks Online",
			settlementEvidence: accountingPayments.length > 0 ? "incomplete" : "estimated",
			evidenceGap: `${accountingPaymentGap("QuickBooks", accountingPayments)}${truncatedPaymentApplications.has(inv.Id) || merged.truncated ? " More than 1,000 applications were linked; the displayed list is capped and the complete source response remains in the raw vault." : ""}`,
			accountingPayments,
			createdAt: new Date().toISOString(),
			invoice: {
				invoiceId: inv.DocNumber || inv.Id,
				vendorOrClient: inv.CustomerRef?.name || "QuickBooks Customer",
				issueDate: inv.TxnDate || new Date().toISOString().slice(0, 10),
				dueDate: inv.TxnDate || new Date().toISOString().slice(0, 10),
				expectedAmount: { amountMinor: minor, currency: ccy },
				expectedSettlementCurrency: ccy,
				contractedChargeBearer: "SHA",
				withholdingTaxRateBps: undefined,
				remittanceHint: inv.DocNumber || inv.Id,
				sourceRefs: [
					{
						sourceType: "platform_csv",
						recordId: inv.Id,
						field: "quickbooks.invoice",
						rawExcerpt: JSON.stringify(inv),
					},
				],
			},
			wire: {
				wireId: `UNMATCHED-QBO-${inv.Id}`,
				format: "bank_csv",
				valueDate: inv.TxnDate || new Date().toISOString().slice(0, 10),
				settledAmount: { amountMinor: 0, currency: ccy },
				chargeBearer: "SHA",
				senderCharges: [],
				receiverCharges: [],
				sourceRefs: [],
			},
		}
	})
	const returnedInvoiceIds = new Set(invoices.map((invoice) => invoice.Id))
	for (const [invoiceId, applications] of applicationsByInvoice) {
		if (returnedInvoiceIds.has(invoiceId)) continue
		const priorCase = priorCasesByInvoice.get(invoiceId)
		if (!priorCase) continue
		const merged = mergeAccountingPaymentApplications(priorCase.accountingPayments, applications)
		cases.push({
			...priorCase,
			settlementEvidence: "incomplete",
			accountingPayments: merged.applications,
			evidenceGap: `${accountingPaymentGap("QuickBooks", merged.applications)} The linked invoice record was loaded from an earlier local sync because it was outside this incremental invoice window.${merged.truncated ? " More than 1,000 applications are linked; the displayed list is capped and the full provider responses remain in the raw vault." : ""}`,
		})
	}
	return {
		recordsFetched: invoices.length + payments.length,
		cases,
		rawPayload: combineRawPages(rawPages),
		warnings: unresolvedInvoiceCount > 0
			? [`${unresolvedInvoiceCount} QuickBooks payment link(s) referenced invoice records that were not retrieved within the ${LINKED_INVOICE_LOOKUP_BATCH_SIZE * MAX_LINKED_INVOICE_LOOKUP_BATCHES}-invoice lookup limit. The linked IDs remain in the raw provider response and were not mapped into cases.`]
			: undefined,
	}
}

async function fetchXeroCases(
	credentials: IntegrationCredentials,
	config: Record<string, string>,
	lastSuccessfulSyncAt?: string,
	existingCases: SettlementCase[] = [],
): Promise<ConnectorFetchResult> {
	const tenantId = config.tenantId?.trim()
	if (!tenantId) {
		throw new Error("Xero integration requires a Xero Tenant ID.")
	}
	const invoices: Array<{
		InvoiceID: string
		InvoiceNumber?: string
		CurrencyCode?: string
		Total?: number
		DateString?: string
		Contact?: { Name?: string }
	}> = []
	const payments: Array<{
		PaymentID: string
		Date?: string
		DateString?: string
		Amount?: number
		Status?: string
		IsReconciled?: boolean
		Invoice?: { InvoiceID?: string }
	}> = []
	const rawPages: string[] = []
	const since = syncSince(lastSuccessfulSyncAt)
	const fetchXeroPages = async <T,>(resource: "Invoices" | "Payments", target: T[]) => {
		for (let page = 1; page <= MAX_PROVIDER_SYNC_PAGES; page += 1) {
			const headers = new Headers({
				Authorization: authHeader(credentials),
				"Xero-tenant-id": tenantId,
				Accept: "application/json",
			})
			if (since) headers.set("If-Modified-Since", since.toISOString().slice(0, 19))
			const res = await fetchProvider(`https://api.xero.com/api.xro/2.0/${resource}?page=${page}&pageSize=${ACCOUNTING_PAGE_SIZE}`, { headers })
			if (!res.ok) throw new Error(`Xero ${resource} API error (${res.status}): ${(await res.text()).slice(0, 200)}`)
			const rawPage = await res.text()
			rawPages.push(rawPage)
			const json = JSON.parse(rawPage) as Record<string, T[]>
			const pageRecords = json[resource] ?? []
			target.push(...pageRecords)
			if (pageRecords.length < ACCOUNTING_PAGE_SIZE) break
			if (page === MAX_PROVIDER_SYNC_PAGES) throw new Error(`Xero ${resource.toLowerCase()} sync exceeded the ${MAX_PROVIDER_SYNC_PAGES}-page safety limit.`)
		}
	}
	await fetchXeroPages("Invoices", invoices)
	await fetchXeroPages("Payments", payments)
	const priorCasesByInvoice = existingAccountingInvoiceCases(existingCases, "xero.invoice")
	const linkedInvoiceIds = [...new Set(payments.map((payment) => payment.Invoice?.InvoiceID).filter((id): id is string => Boolean(id)))]
	const currentInvoiceIds = new Set(invoices.map((invoice) => invoice.InvoiceID))
	const missingInvoiceIds = linkedInvoiceIds.filter((id) => !currentInvoiceIds.has(id) && !priorCasesByInvoice.has(id))
	for (let offset = 0; offset < missingInvoiceIds.length && offset / LINKED_INVOICE_LOOKUP_BATCH_SIZE < MAX_LINKED_INVOICE_LOOKUP_BATCHES; offset += LINKED_INVOICE_LOOKUP_BATCH_SIZE) {
		const batch = missingInvoiceIds.slice(offset, offset + LINKED_INVOICE_LOOKUP_BATCH_SIZE)
		const url = new URL("https://api.xero.com/api.xro/2.0/Invoices")
		url.searchParams.set("IDs", batch.join(","))
		url.searchParams.set("page", "1")
		url.searchParams.set("pageSize", String(batch.length))
		const res = await fetchProvider(url, {
			headers: {
				Authorization: authHeader(credentials),
				"Xero-tenant-id": tenantId,
				Accept: "application/json",
			},
		})
		if (!res.ok) throw new Error(`Xero linked invoice lookup error (${res.status}): ${(await res.text()).slice(0, 200)}`)
		const rawPage = await res.text()
		rawPages.push(rawPage)
		const json = JSON.parse(rawPage) as { Invoices?: typeof invoices }
		invoices.push(...(json.Invoices ?? []))
	}
	const invoicesById = new Map(invoices.map((invoice) => [invoice.InvoiceID, invoice]))
	const foundInvoiceIds = new Set(invoices.map((invoice) => invoice.InvoiceID))
	const unresolvedInvoiceCount = linkedInvoiceIds.filter((id) => !foundInvoiceIds.has(id) && !priorCasesByInvoice.has(id)).length
	const applicationsByInvoice = new Map<string, AccountingPaymentApplication[]>()
	const truncatedPaymentApplications = new Set<string>()
	for (const payment of payments) {
		const invoiceId = payment.Invoice?.InvoiceID
		if (!invoiceId) continue
		const invoice = invoicesById.get(invoiceId)
		const priorCase = priorCasesByInvoice.get(invoiceId)
		if (!invoice && !priorCase) continue
		const ccy = (invoice?.CurrencyCode || priorCase?.invoice?.expectedAmount.currency || "USD").toUpperCase()
		const mappingIssue = payment.Status !== "AUTHORISED"
			? `Xero payment status is ${payment.Status || "missing"}; its amount was not allocated.`
			: typeof payment.Amount !== "number" || !Number.isFinite(payment.Amount) || payment.Amount < 0
				? "Xero did not provide a valid non-negative payment amount."
				: undefined
		const application: AccountingPaymentApplication = {
			provider: "xero",
			applicationId: payment.PaymentID,
			paymentId: payment.PaymentID,
			invoiceRecordId: invoiceId,
			date: xeroPaymentDate(payment.DateString || payment.Date),
			amount: !mappingIssue ? { amountMinor: parseDecimalStringToMinor(String(payment.Amount), ccy), currency: ccy } : undefined,
			status: payment.Status,
			reconciled: payment.IsReconciled,
			mappingIssue,
			sourceRef: {
				sourceType: "platform_csv",
				recordId: payment.PaymentID,
				field: "xero.payment",
				rawExcerpt: JSON.stringify({ paymentId: payment.PaymentID, date: payment.DateString || payment.Date, amount: payment.Amount, currency: ccy, status: payment.Status, isReconciled: payment.IsReconciled, invoiceId }),
			},
		}
		const current = applicationsByInvoice.get(invoiceId) ?? []
		if (current.length < 1000) current.push(application)
		else truncatedPaymentApplications.add(invoiceId)
		applicationsByInvoice.set(invoiceId, current)
	}
	const cases: SettlementCase[] = invoices.map((inv) => {
		const ccy = (inv.CurrencyCode || "USD").toUpperCase()
		const minor = parseDecimalStringToMinor(String(inv.Total ?? 0), ccy)
		const priorCase = priorCasesByInvoice.get(inv.InvoiceID)
		const merged = mergeAccountingPaymentApplications(priorCase?.accountingPayments, applicationsByInvoice.get(inv.InvoiceID) ?? [])
		const accountingPayments = merged.applications
		return {
			caseId: `XERO-${inv.InvoiceNumber || inv.InvoiceID.slice(0, 8)}`,
			title: `Xero Invoice ${inv.InvoiceNumber || inv.InvoiceID}`,
			channelLabel: "Xero Accounting",
			settlementEvidence: accountingPayments.length > 0 ? "incomplete" : "estimated",
			evidenceGap: `${accountingPaymentGap("Xero", accountingPayments)}${truncatedPaymentApplications.has(inv.InvoiceID) || merged.truncated ? " More than 1,000 applications were linked; the displayed list is capped and the complete source response remains in the raw vault." : ""}`,
			accountingPayments,
			createdAt: new Date().toISOString(),
			invoice: {
				invoiceId: inv.InvoiceNumber || inv.InvoiceID,
				vendorOrClient: inv.Contact?.Name || "Xero Contact",
				issueDate: (inv.DateString || new Date().toISOString()).slice(0, 10),
				dueDate: (inv.DateString || new Date().toISOString()).slice(0, 10),
				expectedAmount: { amountMinor: minor, currency: ccy },
				expectedSettlementCurrency: ccy,
				contractedChargeBearer: "SHA",
				withholdingTaxRateBps: undefined,
				remittanceHint: inv.InvoiceNumber || inv.InvoiceID,
				sourceRefs: [
					{
						sourceType: "platform_csv",
						recordId: inv.InvoiceID,
						field: "xero.invoice",
						rawExcerpt: JSON.stringify(inv),
					},
				],
			},
			wire: {
				wireId: `UNMATCHED-XERO-${inv.InvoiceID.slice(0, 8)}`,
				format: "bank_csv",
				valueDate: (inv.DateString || new Date().toISOString()).slice(0, 10),
				settledAmount: { amountMinor: 0, currency: ccy },
				chargeBearer: "SHA",
				senderCharges: [],
				receiverCharges: [],
				sourceRefs: [],
			},
		}
	})
	const returnedInvoiceIds = new Set(invoices.map((invoice) => invoice.InvoiceID))
	for (const [invoiceId, applications] of applicationsByInvoice) {
		if (returnedInvoiceIds.has(invoiceId)) continue
		const priorCase = priorCasesByInvoice.get(invoiceId)
		if (!priorCase) continue
		const merged = mergeAccountingPaymentApplications(priorCase.accountingPayments, applications)
		cases.push({
			...priorCase,
			settlementEvidence: "incomplete",
			accountingPayments: merged.applications,
			evidenceGap: `${accountingPaymentGap("Xero", merged.applications)} The linked invoice record was loaded from an earlier local sync because it was outside this incremental invoice window.${merged.truncated ? " More than 1,000 applications are linked; the displayed list is capped and the full provider responses remain in the raw vault." : ""}`,
		})
	}
	return {
		recordsFetched: invoices.length + payments.length,
		cases,
		rawPayload: combineRawPages(rawPages),
		warnings: unresolvedInvoiceCount > 0
			? [`${unresolvedInvoiceCount} Xero payment link(s) referenced invoice records that were not retrieved within the ${LINKED_INVOICE_LOOKUP_BATCH_SIZE * MAX_LINKED_INVOICE_LOOKUP_BATCHES}-invoice lookup limit. The linked IDs remain in the raw provider response and were not mapped into cases.`]
			: undefined,
	}
}

function fetchHotFolderCases(config: Record<string, string>): ConnectorFetchResult {
	const folder = resolve(process.cwd(), config.hotFolder?.trim() || "data/inbox")
	if (!existsSync(folder)) {
		return { recordsFetched: 0, cases: [] }
	}
	const files = readdirSync(folder).filter((f) => [".json", ".csv", ".txt", ".xml"].includes(extname(f).toLowerCase()))
	const cases: SettlementCase[] = []
	for (const file of files) {
		const raw = readFileSync(resolve(folder, file), "utf8")
		const parsed = normalizeInboundPayloadToCases({ filename: file, content: raw, format: "auto" })
		cases.push(...parsed)
	}
	return { recordsFetched: files.length, cases }
}

async function fetchGenericEndpointCases(
	provider: string,
	credentials: IntegrationCredentials,
	config: Record<string, string>,
): Promise<ConnectorFetchResult> {
	const baseUrl = config.apiBaseUrl?.trim()
	if (!baseUrl) {
		throw new Error(`Provider "${provider}" requires an API endpoint URL in its configuration to poll.`)
	}
	const endpoint = validateProviderEndpointUrl(baseUrl)
	assertProviderEndpointHostAllowed(endpoint)
	await assertProviderEndpointResolvesPublicly(endpoint)
	const res = await fetchProvider(endpoint, {
		headers: { Authorization: authHeader(credentials), Accept: "application/json" },
		redirect: "error",
	})
	if (!res.ok) {
		throw new Error(`${provider} API error (${res.status}): ${(await res.text()).slice(0, 200)}`)
	}
	const raw = await res.text()
	const cases = normalizeInboundPayloadToCases({ content: raw, format: "json" })
	return { recordsFetched: cases.length, cases }
}

export async function fetchCasesFromIntegration(params: {
	integration: IntegrationRecord
	credentials: IntegrationCredentials | null
	lastSuccessfulSyncAt?: string
	existingCases?: SettlementCase[]
}): Promise<ConnectorFetchResult> {
	const { integration, credentials } = params
	switch (integration.provider) {
		case "email_inbound":
			return { recordsFetched: 0, cases: [] }
		case "bank_sftp":
			return fetchHotFolderCases(integration.config)
		case "stripe":
			return fetchStripeCases(credentials ?? {}, params.lastSuccessfulSyncAt)
		case "wise":
			return fetchWiseCases(credentials ?? {}, integration.config)
		case "quickbooks":
			return fetchQuickBooksCases(credentials ?? {}, integration.config, params.lastSuccessfulSyncAt, params.existingCases)
		case "xero":
			return fetchXeroCases(credentials ?? {}, integration.config, params.lastSuccessfulSyncAt, params.existingCases)
		default:
			return fetchGenericEndpointCases(integration.provider, credentials ?? {}, integration.config)
	}
}
