import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenScout API",
  metadataBase: new URL("https://api.openscout.app"),
  description: "OpenScout feedback ingestion and report review surface.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
