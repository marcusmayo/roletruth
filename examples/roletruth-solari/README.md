# RoleTruth Solari example

This command is the one-URL, end-to-end Solari proof behind RoleTruth's live
evidence path.

It:

1. launches a recorded standard Solari Browser session;
2. renders a public source and captures its HTTP result, final URL, body text,
   page title, first H1, schema.org `JobPosting` JSON-LD, and full-page
   screenshot;
3. classifies the capture as usable, blocked, authentication-required,
   not-a-job, empty, or failed;
4. proposes source-linked job assertions only when the source is eligible;
5. uploads the screenshot and capture manifest into a Solari Sandbox;
6. runs the deterministic verifier, which checks both hashes and admits a claim
   only when its exact quote exists in the sealed text; and
7. prints the analysis status, source-quality decision, verified findings, and
   Browser/Sandbox receipts.

From the repository root, use an ordinary public employer or ATS job page:

```bash
export SOLARI_API_KEY=slr_live_your_key
npm run roletruth:solari -- https://example.com/careers/example-role
```

The default is a recorded, non-stealth Browser session compatible with Solari
Free. Leave `SOLARI_BROWSER_STEALTH` and `SOLARI_BROWSER_WEB_BOT_AUTH` unset on
Free. If a paid account supports those features, they remain explicit opt-ins:

```bash
SOLARI_BROWSER_STEALTH=true npm run roletruth:solari -- https://example.com/job
```

## Reading the outcome

- `analysisStatus: "complete"` means at least one usable source produced
  verified role terms.
- `analysisStatus: "insufficient"` is an honest result, not a silent fallback.
  Inspect `source.acquisitionStatus`, `source.documentType`, and diagnostics.
- `blocked` or `auth_required` means the Browser reached a challenge or account
  wall rather than the requested job evidence. On Free, use an accessible
  employer page or provide the job screenshot through the frontend.
- `not_job` means the rendered page is company context or otherwise lacks
  reliable job-posting signals. A company name may be verified from a company
  profile, but RoleTruth will not invent a role.

The captured screenshot is uploaded only to the temporary Sandbox so its hash
can be verified. The browser and sandbox are released in `finally` blocks.
Signed replay, CDP, WebSocket, and file capability URLs are never printed.
