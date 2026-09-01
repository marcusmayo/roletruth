# Evidence model

RoleTruth separates acquisition, evidence, assertions, verdicts, and
calculations so no model output can silently become a fact.

## Entities

| Entity | Purpose | Integrity fields |
|---|---|---|
| Source | One captured URL, screenshot, or explicit test fixture | requested/final URL, publisher, capture time, SHA-256, browser session |
| Evidence span | Exact source text eligible to support a claim | source ID, quote, text offsets or screenshot location |
| Assertion | A normalized value proposed from a span | field, raw value, normalized value, extractor version |
| Finding | The deterministic verdict for one atomic field | status, evidence IDs, rule ID, clarification question |
| Calculation | A derived scenario, never a quoted source fact | formula, inputs, evidence IDs, assumptions |

## Atomic fields

- Location: work mode and relocation are separate.
- Compensation: rate/basis, derived scenarios, and actual total are separate.
- Engagement: duration and worker classification are separate.
- Application: materials, steps, deadline, and evaluation signal are separate.

This prevents false conflicts such as treating “full-time” and “contractor” as
opposites, or treating an annualized rate and a prorated scenario as competing
salary claims.

## Verdict rules

- **Confirmed — RT-R1:** at least one eligible explicit assertion exists and
  every other eligible assertion is compatible.
- **Conflicted — RT-R2:** eligible assertions are materially incompatible.
  Authority is displayed; it does not erase disagreement.
- **Unknown — RT-R3:** no eligible explicit assertion exists, capture failed,
  or the wording is ambiguous.
- **Calculated — RT-C1:** the result exposes its formula, evidence inputs, and
  scenario assumptions.

Absence is never negative evidence. Duplicate content does not become
independent corroboration. A later source supersedes an earlier one only when
it explicitly identifies itself as a correction.
