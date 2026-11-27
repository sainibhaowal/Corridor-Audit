# 05 · Financial calculations and matching rules

## Amount representation

The accounting model stores monetary values in integer minor units. `src/core/money.ts` explicitly assigns zero decimal places to JPY, KRW, and VND, and three to BHD, JOD, KWD, OMR, and TND. Other currency codes default to two decimals.

Currency conversion multiplies a JavaScript numeric amount by the configured rate and scale, then uses `Math.round`. This reduces repeated decimal-place arithmetic for amounts but is not arbitrary-precision decimal arithmetic and does not, by itself, guarantee zero rounding error for every input size or rate.

## Reconciliation residual

The audit tool computes:

```text
variance = midMarketExpected
         - fxSpreadLoss
         - deductedFees
         - normalizedWithholdingTax
         - netSettled
```

The displayed zero residual means the supplied values reconcile under the implemented calculation. It is not proof that source records are genuine, all relevant charges were supplied, or the model's extracted values are correct.

## FX spread estimate

The reference amount is the instructed amount converted at the rate returned for the supplied value date. When a bank-applied rate is present, the implementation estimates the spread as the reference amount less the amount converted at that applied rate. When it is absent, the implementation infers a residual using settlement amount, known fees, and withholding. The code does not clamp a negative spread to zero. Results depend on input completeness and rate availability.

The Frankfurter service is used for ECB reference-rate lookup, with bundled fallback values where available. A reference rate is a comparison point; it is not a quote that proves the rate a user could have obtained from a provider.

## Fee and identifier checks

- A recorded `OUR` charge bearer combined with receiver or repair charges can be flagged for operator review. The tool does not determine legal entitlement or guarantee recovery.
- IBAN validation performs a general format check and Mod-97 checksum. It does not verify account ownership or validate every country-specific IBAN length rule.
- BIC validation checks the expected character/length format; it does not verify that a BIC is active or belongs to the named institution.
- Orphan, duplicate-versus-split, and account-change checks are deterministic matching heuristics over supplied case records. They are review flags, not fraud determinations.

See [`src/core/money.ts`](../../src/core/money.ts), [`src/runtime/tools/wire-tools.ts`](../../src/runtime/tools/wire-tools.ts), and [`src/runtime/tools/anomaly-tools.ts`](../../src/runtime/tools/anomaly-tools.ts) for implementation details.
