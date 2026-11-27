export type CurrencyCode = string

export type ChargeBearerClause = "OUR" | "SHA" | "BEN"

export type SourceType =
	| "invoice"
	| "mt103"
	| "camt053"
	| "bank_csv"
	| "platform_csv"
	| "pdf_extract"
	| "workspace_policy"
	| "ecb_fx"

export interface Money {
	amountMinor: number
	currency: CurrencyCode
}

export interface SourceRef {
	sourceType: SourceType
	recordId: string
	field: string
	rawExcerpt: string
	url?: string
}

export interface InvoiceLineItem {
	description: string
	quantity: number
	unitPriceMinor: number
	lineTotalMinor: number
}

export interface InvoiceInput {
	invoiceId: string
	vendorOrClient: string
	vendorIban?: string
	vendorBic?: string
	issueDate: string
	dueDate: string
	expectedAmount: Money
	expectedSettlementCurrency: CurrencyCode
	contractedChargeBearer: ChargeBearerClause
	withholdingTaxRateBps?: number
	taxMinor?: number
	discountMinor?: number
	lineItems?: InvoiceLineItem[]
	remittanceHint?: string
	priorAccountRef?: string
	sourceRefs?: SourceRef[]
}

export interface WireOrBankInput {
	wireId: string
	transactionRef?: string
	format: "mt103" | "bank_csv" | "camt053" | "platform_payout"
	platformName?: "upwork" | "stripe" | "wise" | "paypal" | "payoneer" | "direct_bank"
	rawText?: string
	valueDate: string
	instructedAmount?: Money
	settledAmount: Money
	bankAppliedRate?: number
	chargeBearer?: ChargeBearerClause
	platformFee?: Money
	senderCharges: Money[]
	receiverCharges: Money[]
	repairFee?: Money
	remittanceInfo?: string
	senderName?: string
	beneficiaryName?: string
	beneficiaryAccountRef?: string
	offHours?: boolean
	watchlistTag?: string
	sourceRefs?: SourceRef[]
}

export interface FxRateRecord {
	from: CurrencyCode
	to: CurrencyCode
	requestedDate: string
	ecbRateDate: string
	midMarketRate: number
	source: "frankfurter_live" | "bundled_ecb_cache" | "same_currency_parity"
	sourceUrl: string
}

export interface SettlementCase {
	caseId: string
	title: string
	channelLabel: string
	/** `observed` requires an independent obligation and supplied settlement evidence. */
	settlementEvidence: "observed" | "estimated" | "incomplete"
	evidenceGap?: string
	invoice?: InvoiceInput
	wire: WireOrBankInput
	candidateWires?: WireOrBankInput[]
	createdAt: string
}

export interface TermsAssessment {
	caseId: string
	invoiceId: string
	expectedGrossMinor: number
	expectedCurrency: CurrencyCode
	expectedSettlementCurrency: CurrencyCode
	contractedChargeBearer: ChargeBearerClause
	withholdingTaxRateBps: number
	withholdingTaxSource: "invoice" | "workspace_profile"
	taxCountry: string
	taxPolicyVersionId: string
	withholdingTaxMinor: number
	lineItemCheckPassed: boolean
	lineItemComputedMinor: number
	ibanValid?: boolean
	ibanIssue?: string
	bicValid?: boolean
	clauseBreachDetected: boolean
	clauseSummary: string
	sourceRefs: SourceRef[]
	agentSummary?: string
}

export interface FxAssessment {
	caseId: string
	rateRecord: FxRateRecord
	midMarketExpectedMinor: number
	fxSpreadLossMinor: number
	fxSpreadBps: number
	corridorBenchmarkBps: number
	corridorStatus: "TRANSPARENT" | "ELEVATED_SPREAD" | "HIGH_MARKUP"
	sourceRefs: SourceRef[]
	agentSummary?: string
}

export interface OrphanMatchCandidate {
	invoiceId: string
	vendorOrClient: string
	score: number
	reasons: string[]
}

export interface WireAssessment {
	caseId: string
	wireId: string
	matchedInvoiceId?: string
	isOrphan: boolean
	orphanMatch?: OrphanMatchCandidate
	normalizedSenderFeesMinor: number
	normalizedReceiverFeesMinor: number
	normalizedRepairFeeMinor: number
	normalizedPlatformFeeMinor: number
	normalizedTotalDeductedFeesMinor: number
	splitPaymentCount: number
	splitTotalSettledMinor: number
	sourceRefs: SourceRef[]
	agentSummary?: string
}

export interface AnomalyAssessment {
	caseId: string
	classification: "NONE" | "TRUE_DUPLICATE" | "SPLIT_INSTALLMENT" | "COLLISION_FALSE_POSITIVE"
	duplicateWireIds: string[]
	duplicateCount: number
	vendorBankChanged: boolean
	bankChangeDetails?: string
	complianceFlags: string[]
	sourceRefs: SourceRef[]
	agentSummary?: string
}

export type AuditStatus =
	| "CLEAN"
	| "RECOVERABLE_FEE_VIOLATION"
	| "VARIANCE_DETECTED"
	| "VARIANCE_WITHIN_THRESHOLD"
	| "EVIDENCE_INCOMPLETE"
	| "DUPLICATE_WIRE"
	| "ORPHAN_MATCHED"
	| "FX_MARKUP_ALERT"
	| "ABORTED_BY_OPERATOR"

export interface AuditVerdict {
	caseId: string
	invoiceId: string
	wireId: string
	provenance: {
		appVersion: string
		sourceRevision: string
		workingTree: "clean" | "modified" | "unknown"
		auditRulesVersion: string
	}
	status: AuditStatus
	plainEnglishSummary: string
	numbers: {
		invoicedMinor: number
		invoicedCurrency: string
		midMarketEquivalentMinor: number
		settledMinor: number
		settledCurrency: string
		fxSpreadLossMinor: number
		fxSpreadBps: number
		liftingAndRepairFeesMinor: number
		platformFeeMinor: number
		withholdingTaxMinor: number
		recoverableFeeMinor: number
		unexplainedVarianceMinor: number
	}
	replay: {
		actualNetMinor: number
		optimalTransparentNetMinor: number
		totalLeakMinor: number
		totalLeakBps: number
	}
	sourceRefs: SourceRef[]
	disputeNotice?: string
	humanOverrideNote?: string
	disclaimer: "Synthetic/public data demonstration only. Not financial or legal advice."
	completedAt: string
}

export interface PendingBreakpointDecision {
	approvalId?: string
	caseId: string
	agentName: string
	toolName: string
	actionType: string
	question: string
	proofLine: string
	recoverableMinor: number
	currency: CurrencyCode
	argsJson: string
	riskLabel: string
	createdAt: string
}

export interface TrajectoryEvent {
	id: string
	caseId: string
	timestamp: string
	kind:
		| "phase.changed"
		| "case.queued"
		| "agent.started"
		| "agent.thinking"
		| "agent.reasoning"
		| "agent.stream"
		| "agent.completed"
		| "tool.started"
		| "tool.completed"
		| "overlap.updated"
		| "breakpoint.paused"
		| "breakpoint.resolved"
		| "ledger.entry"
		| "audit.verdict"
		| "error"
	agentName?: string
	phase?: string
	toolName?: string
	callId?: string
	durationMs?: number
	status?: string
	text?: string
	argsJson?: string
	resultJson?: string
	sourceRefs?: SourceRef[]
	payload?: Record<string, unknown>
}
