import { parseDecimalStringToMinor } from "../money"
import type { ChargeBearerClause, Money, SourceRef, WireOrBankInput } from "../types"

function extractTag(block: string, tag: string): string | undefined {
	const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))
	return match ? match[1].trim() : undefined
}

function extractMoneyElement(block: string, tag: string): Money | undefined {
	const match = block.match(new RegExp(`<${tag}[^>]*Ccy=["']([A-Z]{3})["'][^>]*>([^<]+)<\\/${tag}>`, "i"))
	if (!match) return undefined
	const currency = match[1].toUpperCase()
	return { amountMinor: parseDecimalStringToMinor(match[2], currency), currency }
}

/**
 * Lightweight zero-dependency ISO 20022 camt.053 / pacs.008 XML parser.
 */
export function parseCamt053Xml(rawXml: string): WireOrBankInput[] {
	const entries = rawXml.match(/<(Ntry|CdtTrfTxInf)[\s\S]*?<\/\1>/gi) ?? [rawXml]
	return entries.map((entry, idx) => {
		const txId = extractTag(entry, "EndToEndId") || extractTag(entry, "NtryRef") || `CAMT-${idx + 1}`
		const wireId = txId.startsWith("WIRE-") ? txId : `WIRE-${txId}`
		const settledAmount = extractMoneyElement(entry, "Amt") ??
			extractMoneyElement(entry, "IntrBkSttlmAmt") ?? { amountMinor: 0, currency: "EUR" }
		const instructedAmount = extractMoneyElement(entry, "InstdAmt")
		const chrgAmt = extractMoneyElement(entry, "ChrgAmt") ?? extractMoneyElement(entry, "TtlChrgsAndTaxAmt")
		const valDt =
			extractTag(extractTag(entry, "ValDt") ?? "", "Dt") ||
			extractTag(entry, "IntrBkSttlmDt") ||
			"2026-11-24"
		const remittanceInfo = extractTag(entry, "Ustrd")
		const senderName = extractTag(extractTag(entry, "Dbtr") ?? "", "Nm")
		const bearerRaw = (extractTag(entry, "ChrgBr") ?? "").toUpperCase()
		const chargeBearer: ChargeBearerClause | undefined =
			bearerRaw === "DEBT"
				? "OUR"
				: bearerRaw === "CRED"
					? "BEN"
					: bearerRaw === "SHAR"
						? "SHA"
						: undefined

		const receiverCharges: Money[] = chrgAmt && chrgAmt.amountMinor > 0 ? [chrgAmt] : []
		const repairText = extractTag(entry, "AddtlNtryInf") ?? ""
		const repairMatch = repairText.match(/REPAIR[:\s]+([A-Z]{3})\s*([0-9.,]+)/i)
		const repairFee: Money | undefined = repairMatch
			? {
					amountMinor: parseDecimalStringToMinor(repairMatch[2], repairMatch[1].toUpperCase()),
					currency: repairMatch[1].toUpperCase(),
				}
			: undefined

		const sourceRefs: SourceRef[] = [
			{
				sourceType: "camt053",
				recordId: wireId,
				field: "xml_entry",
				rawExcerpt: entry.slice(0, 280),
			},
		]

		return {
			wireId,
			transactionRef: txId,
			format: "camt053",
			platformName: "direct_bank",
			rawText: entry,
			valueDate: valDt.slice(0, 10),
			instructedAmount,
			settledAmount,
			chargeBearer,
			senderCharges: [],
			receiverCharges,
			repairFee,
			remittanceInfo,
			senderName,
			sourceRefs,
		}
	})
}
