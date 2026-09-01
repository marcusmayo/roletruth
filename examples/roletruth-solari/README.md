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
npm run roletruth:solari -- https://github.com/marcusmayo/roletruth
```

The default is a recorded standard Browser session compatible with Solari
Free. If the account is on Starter or higher and the target needs bot-defense
evasion, opt in with `SOLARI_BROWSER_STEALTH=true`. Web Bot Auth is separately
opt-in with `SOLARI_BROWSER_WEB_BOT_AUTH=true` when it is enabled for the
account.

The browser and sandbox are released in `finally` blocks. Signed replay and
connection URLs are never printed.
