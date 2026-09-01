import type { NextConfig } from "next";

import { buildContentSecurityPolicy } from "./lib/security-headers.ts";

const nextConfig: NextConfig = {
  agentRules: false,
  // Solari's browser client ships Node-only runtime assets through Patchright.
  // Keep those packages out of Turbopack's route bundle so Codespaces loads
  // them directly in the Node server process.
  serverExternalPackages: [
    "@solarisdk/browser",
    "@solarisdk/sdk",
    "patchright-core",
    "tesseract.js",
    "tesseract.js-core",
  ],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: buildContentSecurityPolicy(),
          },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
