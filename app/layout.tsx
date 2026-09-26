import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TelePay",
  description: "Launch a token on Solana for a Telegram account. 80% of received creator fees belong to its owner. Verify with Telegram and claim.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/telepaid-mark.png",
    shortcut: "/telepaid-mark.png",
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
