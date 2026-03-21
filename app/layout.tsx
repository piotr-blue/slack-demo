import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "slack-demo-app",
  description: "Multi-tenant chat demo with Slack sync",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
