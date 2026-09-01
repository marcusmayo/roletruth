# Threat model

## Assets

- Solari API key and temporary browser/sandbox capabilities
- user-supplied screenshots and public URLs
- captured text, screenshots, timestamps, and content hashes
- the integrity of finding states and calculation labels

## Trust boundaries

1. Browser input is untrusted.
2. Rendered page and OCR text are untrusted data, including prompt-injection text.
3. Solari credentials exist only on the server.
4. The deterministic resolver—not source text or an LLM—assigns verdicts.
5. Exported evidence is user-controlled and may be shared publicly.

## Controls implemented

- public `http` and `https` schemes only;
- rejection of credential-bearing URLs, localhost, IP literals in private,
  loopback, link-local, and IPv6 local ranges;
- maximum three live URLs and 200,000 rendered characters per source;
- bounded Browser, navigation, Sandbox, and command timeouts;
- resource cleanup in `finally` blocks;
- no API key, signed replay URL, CDP endpoint, or WebSocket endpoint in the report;
- browser-side screenshot staging computes a local SHA-256 but does not upload
  in the keyless demo;
- React escaping plus a restrictive CSP, frame denial, MIME sniffing denial,
  referrer policy, and permissions policy;
- explicit Demo versus Solari Live labeling; no silent fallback;
- zero-confirmed-without-evidence invariant covered by automated tests.

## Known limitations

- The application blocks obvious private targets before handing a URL to Solari,
  but this MVP does not independently resolve DNS before navigation. A hostname
  that later resolves to a private address requires gateway-level egress policy.
- Generic screenshot OCR is not shipped in the keyless demo. Screenshots are
  staged and hashed; the golden fixture contains reviewed exact spans.
- The live extractor is intentionally narrow and English-first. Unsupported
  phrasing becomes Unknown.
- Public sources can change after capture. A new capture should create a new
  report rather than mutate an old one.
- Authenticated sources are out of scope for this public MVP.
