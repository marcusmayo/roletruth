import type { LaunchOptions } from "@solarisdk/browser";

type SolariEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Keep the default launch compatible with Solari's Free plan. Advanced
 * browser features are opt-in so adding an API key cannot silently request a
 * paid capability.
 */
export function buildSolariLaunchOptions(
  environment: SolariEnvironment = process.env,
): LaunchOptions {
  return {
    recording: true,
    retries: 1,
    probe: true,
    probeTimeoutMs: 5_000,
    ...(environment.SOLARI_BROWSER_STEALTH === "true"
      ? { stealth: true }
      : {}),
    ...(environment.SOLARI_BROWSER_WEB_BOT_AUTH === "true"
      ? { webBotAuth: true }
      : {}),
  };
}
