import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenScout Feedback API",
  metadataBase: new URL("https://api.openscout.app"),
  description: "OpenScout app feedback ingestion and review surface.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
