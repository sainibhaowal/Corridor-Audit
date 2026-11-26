import { parseDecimalStringToMinor } from "../money"
import type { ChargeBearerClause, Money, SourceRef, WireOrBankInput } from "../types"

function formatSwiftDate(yymmdd: string): string {
	const clean = yymmdd.trim()
	if (!/^\d{6}$/.test(clean)) return "2026-11-24"
	const yy = Number(clean.slice(0, 2))
	const mm = clean.slice(2, 4)
	const dd = clean.slice(4, 6)
	const year = yy >= 70 ? 1900 + yy : 2000 + yy
	return `${year}-${mm}-${dd}`
}

function parseTagMoney(value: string): Money | undefined {
	const match = value.trim().match(/^([A-Z]{3})\s*([0-9][0-9.,]*)/)
	if (!match) return undefined
	const currency = match[1].toUpperCase()
	const amountMinor = parseDecimalStringToMinor(match[2], currency)
	return { amountMinor, currency }
}

/**
 * Splits a multi-block SWIFT text file into individual MT103 message blocks
 * and parses standard fields (:20:, :32A:, :33B:, :36:, :50K/F:, :59:, :70:, :71A/F/G:).
 */
export function parseMt103Blocks(rawText: string): WireOrBankInput[] {
	const blocks = rawText
		.split(/\r?\n-{3,}\r?\n|\{1:F01/)
		.map((b, idx) => (rawText.includes("{1:F01") && idx > 0 ? `{1:F01${b}` : b))
		.map((b) => b.trim())
		.filter((b) => b.includes(":20:") || b.includes(":32A:"))

	if (blocks.length === 0 && (rawText.includes(":20:") || rawText.includes(":32A:"))) {
		return [parseSingleMt103(rawText, 0)]
	}
	return blocks.map((block, idx) => parseSingleMt103(block, idx))
}

export function parseSingleMt103(rawBlock: string, index = 0): WireOrBankInput {
	const lines = rawBlock.split(/\r?\n/)
	const tags: Array<{ tag: string; value: string; rawLine: string }> = []

	let current: { tag: string; value: string; rawLine: string } | null = null
	for (const line of lines) {
		const tagMatch = line.match(/^:(\d{2}[A-Z]?):(.*)$/)
		if (tagMatch) {
			if (current) tags.push(current)
			current = { tag: tagMatch[1], value: tagMatch[2].trim(), rawLine: line.trim() }
		} else if (current && line.trim() && !line.startsWith("-}") && !line.startsWith("}")) {
			current.value = `${current.value} ${line.trim()}`.trim()
			current.rawLine = `${current.rawLine} ${line.trim()}`.trim()
		}
	}
	if (current) tags.push(current)

	const getFirst = (code: string) => tags.find((t) => t.tag === code)
	const getAll = (code: string) => tags.filter((t) => t.tag === code)

	const refTag = getFirst("20")
	const wireId = refTag?.value ? `WIRE-${refTag.value}` : `WIRE-MT103-${index + 1}`
	const sourceRefs: SourceRef[] = []

	const addRef = (field: string, rawExcerpt: string) => {
		sourceRefs.push({
			sourceType: "mt103",
			recordId: wireId,
			field,
			rawExcerpt,
		})
	}

	if (refTag) addRef(":20:", refTag.rawLine)

	// :32A:YYMMDDCCYAMOUNT
	let valueDate = "2026-11-24"
	let settledAmount: Money = { amountMinor: 0, currency: "USD" }
	const tag32A = getFirst("32A")
	if (tag32A) {
		const m32 = tag32A.value.match(/^(\d{6})([A-Z]{3})([0-9][0-9.,]*)/)
		if (m32) {
			valueDate = formatSwiftDate(m32[1])
			const ccy = m32[2].toUpperCase()
			settledAmount = {
				amountMinor: parseDecimalStringToMinor(m32[3], ccy),
				currency: ccy,
			}
		}
		addRef(":32A:", tag32A.rawLine)
	}

	// :33B:CCYAMOUNT
	let instructedAmount: Money | undefined
	const tag33B = getFirst("33B")
	if (tag33B) {
		instructedAmount = parseTagMoney(tag33B.value)
		addRef(":33B:", tag33B.rawLine)
	}

	// :36:EXCHANGE RATE
	let bankAppliedRate: number | undefined
	const tag36 = getFirst("36")
	if (tag36) {
		const normalizedRate = Number(tag36.value.replace(",", "."))
		if (Number.isFinite(normalizedRate) && normalizedRate > 0) {
			bankAppliedRate = normalizedRate
		}
		addRef(":36:", tag36.rawLine)
	}

	// :50K: / :50F: Ordering customer
	const tag50 = getFirst("50K") ?? getFirst("50F") ?? getFirst("50A")
	const senderName = tag50?.value
	if (tag50) addRef(`:${tag50.tag}:`, tag50.rawLine)

	// :59: Beneficiary
	const tag59 = getFirst("59") ?? getFirst("59A")
	const beneficiaryName = tag59?.value
	if (tag59) addRef(`:${tag59.tag}:`, tag59.rawLine)

	// :70: Remittance information
	const tag70 = getFirst("70")
	const remittanceInfo = tag70 ? tag70.value : undefined
	if (tag70) addRef(":70:", tag70.rawLine)

	// :71A: Charge bearer
	let chargeBearer: ChargeBearerClause | undefined
	const tag71A = getFirst("71A")
	if (tag71A) {
		const bearer = tag71A.value.toUpperCase().slice(0, 3)
		if (bearer === "OUR" || bearer === "SHA" || bearer === "BEN") {
			chargeBearer = bearer
		}
		addRef(":71A:", tag71A.rawLine)
	}

	// :71F: Sender charges
	const senderCharges: Money[] = []
	for (const t71f of getAll("71F")) {
		const m = parseTagMoney(t71f.value)
		if (m && m.amountMinor > 0) senderCharges.push(m)
		addRef(":71F:", t71f.rawLine)
	}

	// :71G: Receiver charges
	const receiverCharges: Money[] = []
	for (const t71g of getAll("71G")) {
		const m = parseTagMoney(t71g.value)
		if (m && m.amountMinor > 0) receiverCharges.push(m)
		addRef(":71G:", t71g.rawLine)
	}

	// Optional repair fee encoded in :72: (/REPAIR/USD28,00)
	let repairFee: Money | undefined
	const tag72 = getFirst("72")
	if (tag72) {
		const repairMatch = tag72.value.match(/REPAIR\/?\s*([A-Z]{3})\s*([0-9][0-9.,]*)/i)
		if (repairMatch) {
			const ccy = repairMatch[1].toUpperCase()
			repairFee = { amountMinor: parseDecimalStringToMinor(repairMatch[2], ccy), currency: ccy }
		}
		addRef(":72:", tag72.rawLine)
	}

	return {
		wireId,
		transactionRef: refTag?.value,
		format: "mt103",
		platformName: "direct_bank",
		rawText: rawBlock,
		valueDate,
		instructedAmount,
		settledAmount,
		bankAppliedRate,
		chargeBearer,
		senderCharges,
		receiverCharges,
		repairFee,
		remittanceInfo,
		senderName,
		beneficiaryName,
		sourceRefs,
	}
}
