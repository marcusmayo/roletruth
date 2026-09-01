# Evidence model

RoleTruth separates acquisition, source quality, evidence, assertions,
verdicts, and calculations so extracted text cannot silently become a fact.
The live path is deterministic; it does not use an LLM to assign verdicts.

## Pipeline

1. **Acquire:** Solari Browser renders a public URL, or the Node server receives
   screenshot bytes and runs English OCR.
2. **Classify:** RoleTruth labels each source `usable`, `blocked`,
   `auth_required`, `not_job`, `empty`, or `error`, and identifies its document
   type when possible.
3. **Seal:** The server hashes the image bytes and sealed text. Both artifacts
   are uploaded to a temporary Solari Sandbox.
4. **Propose:** Bounded JSON-LD and English-text extractors propose atomic
   assertions with a raw value, normalized value, display value, and exact
   source quote.
5. **Verify:** The Sandbox recomputes the hashes, proves that the quote occurs
   in the sealed text, proves the raw phrase occurs in the quote, and applies
   field-specific value checks for safety-critical work-mode and relocation
   claims.
6. **Reconcile:** Compatible verified values become Confirmed, incompatible
   values become Conflicted, and missing or ineligible evidence stays Unknown.

## Entities

| Entity | Purpose | Integrity and provenance fields |
|---|---|---|
| Source | One captured URL, uploaded screenshot, or explicit test fixture | requested/final URL, channel, publisher, authority, HTTP/acquisition state, document type, capture time, image/text SHA-256, Browser session, OCR confidence |
| Evidence span | Exact sealed text eligible to support one or more claims | source ID, quote, character/source location, eligibility |
| Assertion | A bounded extractor proposal from a span | field, raw value, normalized value, display value, evidence ID |
| Finding | The deterministic verdict for one atomic field | status, conclusion, evidence IDs, rule ID, explanation, clarification question |
| Calculation | A derived scenario, never a quoted source fact | formula, inputs, evidence IDs, assumptions, disclaimer |

Channel and authority are not interchangeable. `screenshot` says how evidence
entered the system; it does not identify who published it. Uploaded screenshots
therefore use `unclassified` authority unless a future, separately verified
provenance mechanism establishes more.

## Source eligibility

| Acquisition state | Eligible role evidence? | Treatment |
|---|---:|---|
| `usable` | Yes, after image/text integrity verification | Candidate spans may support atomic role terms |
| `blocked` | No | Bot challenge or access denial remains visible with diagnostics |
| `auth_required` | No | Sign-in/account wall remains visible; use a public source or screenshot fallback |
| `not_job` | No for role terms | A recognized company profile may support `company_name` context only |
| `empty` | No | Unreadable or insufficient text remains Unknown |
| `error` | No | HTTP, acquisition, OCR, or integrity failure remains visible and excluded |

Source authority is displayed for context, but it does not erase a verified
contradiction. A direct source and a third-party source with incompatible terms
still produce a Conflicted finding.

## Atomic fields

- **Role:** company name and role title are separate.
- **Location:** work mode, job location, and relocation requirement are
  separate.
- **Compensation:** quoted rate/basis, derived scenarios, and actual paid total
  are separate.
- **Engagement:** duration and employment classification are separate.
- **Requirements:** required experience and required education are separate;
  preferred language should not become a requirement.
- **Application:** materials, steps, deadline, and evaluation signal are
  separate.

This prevents false conflicts such as treating full-time and contractor as
opposites, or treating an annualized rate and a prorated scenario as competing
salary claims. Normalization is deliberately conservative: equivalent wording
must share a canonical value before RoleTruth treats it as compatible.

## Verdict rules

- **Confirmed — RT-R1:** at least one integrity-verified, eligible, explicit
  assertion exists and every other eligible assertion for that field has a
  compatible normalized value.
- **Conflicted — RT-R2:** two or more eligible assertions have materially
  incompatible normalized values. All linked spans remain visible.
- **Unknown — RT-R3:** no eligible explicit assertion exists, acquisition or
  integrity failed, the source is ineligible, or wording is unsupported or
  ambiguous.
- **Calculated — RT-C1:** a derived result exposes its formula, evidence inputs,
  assumptions, and disclaimer. It is not a quoted or promised value.

Absence is never negative evidence. Duplicate content does not become
independent corroboration. A later source supersedes an earlier one only when
it explicitly identifies itself as a correction; otherwise both remain in the
report.

## Report-level analysis state

- **Complete:** at least one usable source yields a verified non-company role
  assertion and every supplied source is usable.
- **Partial:** usable role evidence is reconciled alongside at least one
  excluded source.
- **Insufficient:** no source is usable or no usable source yields a verified
  non-company role assertion. Company context may still be shown without
  pretending that a role was established.

These labels describe evidence coverage, not hiring confidence or the truth of
the employer's future behavior.

## Integrity scope

The two SHA-256 receipts prove that the bytes and sealed text presented to the
Sandbox match the server's intake/capture artifacts. Exact-span and raw-value
checks bind an assertion to that sealed text. They do not prove that a web page
publisher was honest, that a screenshot was not edited before upload, or that a
source has not changed since capture. Publisher authenticity, external
timestamping, duplicate detection across reports, and long-term evidence
storage are outside this MVP's integrity claim.
