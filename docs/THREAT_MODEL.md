# Threat model

## Assets

- the server-side Solari API key and temporary Browser/Sandbox capabilities;
- user-supplied URLs and screenshot bytes, which may contain personal data;
- rendered page text and images, OCR text, timestamps, and content hashes;
- source-quality classifications and the integrity of assertions, findings, and
  calculation labels; and
- Solari quota, because a live run creates metered Browser and/or Sandbox
  resources.

## Trust boundaries

1. URL strings, uploaded files, filenames, rendered pages, JSON-LD, and OCR
   output are untrusted.
2. A URL run crosses from the Codespaces Node server into a recorded Solari
   Browser session. The returned DOM text, metadata, final URL, HTTP status,
   and screenshot remain untrusted evidence until classified and sealed.
3. A screenshot run sends the actual bytes to the Codespaces Node server,
   where Tesseract.js performs English OCR. The bytes and OCR text are then
   sent to an ephemeral Solari Sandbox for integrity verification.
4. The deterministic extractor may propose assertions; it cannot assign a
   verdict. The Sandbox verifier and reconciler admit evidence and assign
   Confirmed, Conflicted, or Unknown states.
5. Solari credentials and capability URLs stay on the server. Exported report
   data is user-controlled and may be shared publicly.
6. Upload channel and source authority are separate. An uploaded screenshot is
   marked `unclassified`; being user-provided does not make its publisher a
   direct or official source.

## Controls implemented

### Intake and acquisition

- Only public `http` and `https` URL syntax is accepted. Credential-bearing
  URLs, localhost names, obvious private/loopback/link-local IPv4 targets, and
  IPv6 local ranges are rejected before navigation.
- One request may contain at most three URLs, eight screenshots, and eight
  total sources. Each screenshot is limited to 6 MB and combined screenshot
  data to 20 MB.
- The server checks PNG, JPEG, or WebP magic bytes rather than trusting the
  browser-declared MIME type and computes the authoritative screenshot hash
  from the received bytes.
- Rendered and OCR text is capped at 200,000 characters per source. The sealed
  URL record, including page metadata and bounded structured data, is capped at
  300,000 characters.
- Browser navigation is bounded to 60 seconds, client-rendered content gets a
  bounded wait, OCR initialization is bounded to 60 seconds, and each OCR
  operation to 90 seconds. Solari calls and the reconciliation command also
  have explicit timeouts; the Sandbox lifetime is capped at five minutes.
- Browser and Sandbox resources are closed or killed in `finally` blocks.

### Evidence admission

- Source-quality classification runs before extraction. Bot challenges,
  authentication walls, HTTP errors, empty captures, and non-job pages remain
  visible in the source manifest but are excluded from role-term conclusions.
- A company-profile source may contribute only company context; it cannot
  establish a role or its terms.
- The actual captured/uploaded image and sealed text are uploaded to the
  Sandbox. The verifier recomputes both SHA-256 values before a usable source
  becomes eligible.
- A proposed assertion is admitted only when its exact quote occurs in the
  sealed text and its raw phrase occurs inside that quote. The Sandbox also
  recomputes safety-critical work-mode and relocation normalizations so a
  source-backed phrase cannot be paired with a contradictory verdict value.
- Missing, blocked, ambiguous, or integrity-failed evidence stays Unknown.
  Conflicting normalized values remain visible rather than being resolved by
  an authority label.
- Automated tests cover blocked-source exclusion, company-context isolation,
  integrity mismatch, conflicting sources, and value-inconsistent proposals.

### Credential and browser controls

- `SOLARI_API_KEY` is read only by server routes and is never prefixed with
  `NEXT_PUBLIC_` or returned in a report.
- Reports exclude signed replay, CDP, WebSocket, upload, and download
  capability URLs. They retain only non-secret runtime IDs and exit status.
- Uploaded screenshot previews use local browser object URLs. The API response
  does not turn Sandbox file capabilities into public image URLs.
- React escaping plus CSP, frame denial, MIME-sniffing denial, referrer policy,
  and a restrictive permissions policy reduce browser-side injection impact.
- Demo and Solari Live modes are explicit; a failed live run does not silently
  fall back to fixture results.

## Privacy and retention

Screenshots are not merely staged in the browser during a live run. Their bytes
are processed by the Codespaces Node process and Tesseract worker and are
uploaded to the temporary Solari Sandbox. RoleTruth kills the Sandbox when the
request completes, but it does not make claims about provider-side retention
beyond Solari's published service behavior. Users should crop unrelated profile
details, names, messages, notifications, and account information before upload.
The application does not intentionally log screenshot contents or OCR text.

## Known limitations and residual risk

- The app does not independently resolve DNS or revalidate every redirect
  target before Solari navigation. DNS rebinding and private redirect defense
  therefore also depend on Solari/gateway egress policy.
- The live endpoint has no application authentication, user-level quota, or
  rate limiter. Keep a Codespaces forwarded port private. Before exposing the
  Node preview publicly, add access control, request throttling, concurrency
  limits, and quota monitoring so an outsider cannot consume Solari credits or
  CPU through Browser, OCR, and Sandbox runs.
- `request.formData()` parses the multipart body before the application applies
  its aggregate limits. Magic-byte checks do not fully decode an image or cap
  pixel dimensions, so deployment behind an untrusted public edge also needs a
  gateway body limit and image-dimension/decompression-bomb protection.
- OCR is English-first and accuracy depends on crop, scale, contrast,
  compression, and layout. The first OCR run may download/cache language data,
  and a timeout does not cancel all underlying worker activity immediately.
- OCR runs sequentially for up to eight screenshots. Per-operation timeouts do
  not constitute one short end-to-end deadline, so worst-case request duration
  can be materially longer than a one-source demonstration.
- Dynamic extraction is deterministic and deliberately bounded. It is not a
  multimodal or general semantic model. Novel phrasing and normalization
  variants can remain Unknown or be conservatively marked Conflicted.
- URL authority labels only a bounded set of known job-board hosts as
  third-party; every other live host remains unclassified. This is contextual
  metadata, not cryptographic publisher identity. Screenshot authority also
  remains unclassified.
- Standard Free-plan Browser sessions cannot reliably acquire defended or
  authenticated sites. Screenshot fallback still exposes the uploaded bytes to
  the processing boundary described above.
- Public sources can change after capture, and dynamic pages may populate after
  the bounded capture window. A new run creates a new report rather than
  mutating an earlier receipt.
- Authenticated portal profiles, email integrations, account storage, and
  automatic submission are out of scope.
