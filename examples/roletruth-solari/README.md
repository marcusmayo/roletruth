# RoleTruth Solari example

This is the narrow, end-to-end Solari proof behind the RoleTruth frontend.

It:

1. launches a recorded Solari Browser session;
2. renders one public job source and seals its text and screenshot hashes;
3. writes the capture and the stdlib-only reconciliation program into a Solari Sandbox;
4. runs the deterministic reconciler; and
5. prints claim states with browser and sandbox receipts.

From the repository root:

```bash
export SOLARI_API_KEY=slr_live_your_key
npm run roletruth:solari -- https://example.com/job-post
```

The browser and sandbox are released in `finally` blocks. Signed replay and
connection URLs are never printed.
