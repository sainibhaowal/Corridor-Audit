import { existsSync, readdirSync, readFileSync } from "node:fs"
import { extname, resolve } from "node:path"
import type { IntegrationCredentials, IntegrationRecord } from "../db/schema"
import { normalizeInboundPayloadToCases } from "../ingest/normalize-upload"
import type { SettlementCase } from "../types"
import { parseDecimalStringToMinor } from "../money"

export interface ConnectorFetchResult {
	recordsFetched: number
	cases: SettlementCase[]
	rawPayload?: string
}

const MAX_PROVIDER_SYNC_PAGES = 100
const STRIPE_PAGE_SIZE = 100
const WISE_PAGE_SIZE = 100
const ACCOUNTING_PAGE_SIZE = 1000

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

async function fetchStripeCases(credentials: IntegrationCredentials): Promise<ConnectorFetchResult> {
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
	for (let page = 0; page < MAX_PROVIDER_SYNC_PAGES; page += 1) {
		const url = new URL("https://api.stripe.com/v1/payouts")
		url.searchParams.set("limit", String(STRIPE_PAGE_SIZE))
		if (startingAfter) url.searchParams.set("starting_after", startingAfter)
		const res = await fetch(url, { headers: { Authorization: authHeader(credentials) } })
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
		const pRes = await fetch("https://api.transferwise.com/v1/profiles", { headers })
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
		const tRes = await fetch(url, { headers })
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
		CurrencyRef?: { value?: string }
		CustomerRef?: { name?: string }
	}> = []
	const rawPages: string[] = []
	for (let page = 0; page < MAX_PROVIDER_SYNC_PAGES; page += 1) {
		const startPosition = page * ACCOUNTING_PAGE_SIZE + 1
		const query = encodeURIComponent(`SELECT * FROM Invoice ORDERBY MetaData.LastUpdatedTime DESC STARTPOSITION ${startPosition} MAXRESULTS ${ACCOUNTING_PAGE_SIZE}`)
		const res = await fetch(`https://quickbooks.api.intuit.com/v3/company/${encodeURIComponent(realmId)}/query?query=${query}`, {
			headers: { Authorization: authHeader(credentials), Accept: "application/json" },
		})
		if (!res.ok) throw new Error(`QuickBooks API error (${res.status}): ${(await res.text()).slice(0, 200)}`)
		const rawPage = await res.text()
		rawPages.push(rawPage)
		const json = JSON.parse(rawPage) as {
			QueryResponse?: {
				Invoice?: typeof invoices
			}
		}
		const pageInvoices = json.QueryResponse?.Invoice ?? []
		invoices.push(...pageInvoices)
		if (pageInvoices.length < ACCOUNTING_PAGE_SIZE) break
		if (page === MAX_PROVIDER_SYNC_PAGES - 1) throw new Error(`QuickBooks invoice sync exceeded the ${MAX_PROVIDER_SYNC_PAGES}-page safety limit.`)
	}
	const cases: SettlementCase[] = invoices.map((inv) => {
		const ccy = (inv.CurrencyRef?.value || "USD").toUpperCase()
		const minor = parseDecimalStringToMinor(String(inv.TotalAmt), ccy)
		return {
			caseId: `QBO-${inv.DocNumber || inv.Id}`,
			title: `QuickBooks Invoice ${inv.DocNumber || inv.Id}`,
			channelLabel: "QuickBooks Online",
			settlementEvidence: "estimated",
			evidenceGap: "QuickBooks invoice evidence was fetched, but this connector did not fetch a matching payment or bank settlement record. The zero-value unmatched wire is structural only and is not evidence that no payment occurred.",
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
	return { recordsFetched: invoices.length, cases, rawPayload: combineRawPages(rawPages) }
}

async function fetchXeroCases(
	credentials: IntegrationCredentials,
	config: Record<string, string>,
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
	const rawPages: string[] = []
	for (let page = 1; page <= MAX_PROVIDER_SYNC_PAGES; page += 1) {
		const res = await fetch(`https://api.xero.com/api.xro/2.0/Invoices?page=${page}&pageSize=${ACCOUNTING_PAGE_SIZE}`, {
			headers: {
				Authorization: authHeader(credentials),
				"Xero-tenant-id": tenantId,
				Accept: "application/json",
			},
		})
		if (!res.ok) throw new Error(`Xero API error (${res.status}): ${(await res.text()).slice(0, 200)}`)
		const rawPage = await res.text()
		rawPages.push(rawPage)
		const json = JSON.parse(rawPage) as { Invoices?: typeof invoices }
		const pageInvoices = json.Invoices ?? []
		invoices.push(...pageInvoices)
		if (pageInvoices.length < ACCOUNTING_PAGE_SIZE) break
		if (page === MAX_PROVIDER_SYNC_PAGES) throw new Error(`Xero invoice sync exceeded the ${MAX_PROVIDER_SYNC_PAGES}-page safety limit.`)
	}
	const cases: SettlementCase[] = invoices.map((inv) => {
		const ccy = (inv.CurrencyCode || "USD").toUpperCase()
		const minor = parseDecimalStringToMinor(String(inv.Total ?? 0), ccy)
		return {
			caseId: `XERO-${inv.InvoiceNumber || inv.InvoiceID.slice(0, 8)}`,
			title: `Xero Invoice ${inv.InvoiceNumber || inv.InvoiceID}`,
			channelLabel: "Xero Accounting",
			settlementEvidence: "estimated",
			evidenceGap: "Xero invoice evidence was fetched, but this connector did not fetch a matching payment or bank settlement record. The zero-value unmatched wire is structural only and is not evidence that no payment occurred.",
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
	return { recordsFetched: invoices.length, cases, rawPayload: combineRawPages(rawPages) }
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
	const res = await fetch(baseUrl, {
		headers: { Authorization: authHeader(credentials), Accept: "application/json" },
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
}): Promise<ConnectorFetchResult> {
	const { integration, credentials } = params
	switch (integration.provider) {
		case "email_inbound":
			return { recordsFetched: 0, cases: [] }
		case "bank_sftp":
			return fetchHotFolderCases(integration.config)
		case "stripe":
			return fetchStripeCases(credentials ?? {})
		case "wise":
			return fetchWiseCases(credentials ?? {}, integration.config)
		case "quickbooks":
			return fetchQuickBooksCases(credentials ?? {}, integration.config)
		case "xero":
			return fetchXeroCases(credentials ?? {}, integration.config)
		default:
			return fetchGenericEndpointCases(integration.provider, credentials ?? {}, integration.config)
	}
}
