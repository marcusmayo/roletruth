import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RoleTruth · Auditable job requirement reconciliation",
  description:
    "Turn scattered job-post evidence into confirmed, conflicted, and unknown role terms with exact provenance.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
