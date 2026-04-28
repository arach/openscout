import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OpenScout Fleet Console",
  metadataBase: new URL("https://api.openscout.app"),
  description: "OpenScout compute fleet and agent operations console.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
