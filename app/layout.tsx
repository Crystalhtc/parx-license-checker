import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PaRx Prescriber Verification",
  description: "Verify a physician's registration status across CPSBC, CPSO, and CPSA.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-ink">{children}</body>
    </html>
  );
}
