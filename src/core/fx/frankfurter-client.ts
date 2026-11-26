import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { CurrencyCode, FxRateRecord } from "../types"

interface FallbackRatesFile {
	defaultDate: string
	baseRatesFromEUR: Record<string, number>
	historical: Record<string, Record<string, number>>
}

const rateMemoryCache = new Map<string, FxRateRecord>()
let fallbackDataCache: FallbackRatesFile | null = null

function loadFallbackRates(): FallbackRatesFile {
	if (fallbackDataCache) return fallbackDataCache
	const filePath = resolve(process.cwd(), "data/fallback-rates.json")
	fallbackDataCache = JSON.parse(readFileSync(filePath, "utf8")) as FallbackRatesFile
	return fallbackDataCache
}

function getFallbackPairRate(from: CurrencyCode, to: CurrencyCode, requestedDate: string): FxRateRecord {
	const data = loadFallbackRates()
	const pairKey = `${from}_${to}`
	const exactDateMap = data.historical[requestedDate]

	if (exactDateMap && exactDateMap[pairKey]) {
		return {
			from,
			to,
			requestedDate,
			ecbRateDate: requestedDate,
			midMarketRate: exactDateMap[pairKey],
			source: "bundled_ecb_cache",
			sourceUrl: `https://api.frankfurter.app/${requestedDate}?from=${from}&to=${to}`,
		}
	}

	const fromEur = data.baseRatesFromEUR[from]
	const toEur = data.baseRatesFromEUR[to]
	const derivedRate = fromEur && toEur ? Number((toEur / fromEur).toFixed(6)) : 1.0

	return {
		from,
		to,
		requestedDate,
		ecbRateDate: data.defaultDate,
		midMarketRate: derivedRate,
		source: "bundled_ecb_cache",
		sourceUrl: `https://api.frankfurter.app/${data.defaultDate}?from=${from}&to=${to}`,
	}
}

/**
 * Fetches official ECB mid-market exchange rate from public Frankfurter API (`api.frankfurter.app`)
 * with 5-second timeout and automatic fallback to bundled ECB cache.
 */
export async function fetchEcbMidMarketRate(params: {
	fromCurrency: CurrencyCode
	toCurrency: CurrencyCode
	valueDate: string
}): Promise<FxRateRecord> {
	const from = params.fromCurrency.trim().toUpperCase()
	const to = params.toCurrency.trim().toUpperCase()
	const date = (params.valueDate || "latest").trim()

	if (from === to) {
		return {
			from,
			to,
			requestedDate: date,
			ecbRateDate: date,
			midMarketRate: 1.0,
			source: "same_currency_parity",
			sourceUrl: "parity://1.0",
		}
	}

	const cacheKey = `${date}:${from}->${to}`
	const cached = rateMemoryCache.get(cacheKey)
	if (cached) return cached

	const url = `https://api.frankfurter.app/${encodeURIComponent(date)}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`

	try {
		const controller = new AbortController()
		const timeout = setTimeout(() => controller.abort(), 5000)
		const response = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeout))
		if (!response.ok) {
			throw new Error(`Frankfurter HTTP ${response.status}`)
		}
		const json = (await response.json()) as { date?: string; rates?: Record<string, number> }
		const rate = json.rates?.[to]
		if (!rate || !Number.isFinite(rate)) {
			throw new Error(`Frankfurter response missing rate for ${to}`)
		}
		const record: FxRateRecord = {
			from,
			to,
			requestedDate: date,
			ecbRateDate: json.date || date,
			midMarketRate: rate,
			source: "frankfurter_live",
			sourceUrl: url,
		}
		rateMemoryCache.set(cacheKey, record)
		return record
	} catch {
		const fallback = getFallbackPairRate(from, to, date)
		rateMemoryCache.set(cacheKey, fallback)
		return fallback
	}
}
