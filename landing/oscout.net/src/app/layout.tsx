import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import { GoogleAnalyticsTag } from "@/components/google-analytics-tag";
import { siteBaseUrl } from "@/lib/site-links";
import "./globals.css";

// Basel — one grotesque across the whole system. Every legacy font variable
// (--font-spectral / --font-mono-display / --font-geist-* / --font-display) is
// aliased to this single family in globals.css, so hierarchy comes from weight
// and scale alone, never from a second face.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Scout — Local Agent Broker",
  metadataBase: new URL(siteBaseUrl),
  manifest: "/site.webmanifest",
  description:
    "Broker-backed local communication and execution for AI agents. Durable conversations, explicit invocations, tracked flights, bridges, a native Mac app, and a local web dashboard.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/openscout-icon.png", type: "image/png", sizes: "1024x1024" },
    ],
    shortcut: ["/favicon.ico"],
    apple: [
      { url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" },
    ],
  },
  openGraph: {
    title: "Scout",
    description: "Your local agent broker. Durable conversation, work, routing, and bridges for AI agents.",
    url: siteBaseUrl,
    siteName: "Scout",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Scout — Your local agent broker.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Scout",
    description: "Your local agent broker. Durable conversation, work, routing, and bridges for AI agents.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-site-theme="light">
      <body
        className={`${archivo.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <GoogleAnalyticsTag />
      </body>
    </html>
  );
}
