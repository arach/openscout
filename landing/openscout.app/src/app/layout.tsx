import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import { GoogleAnalyticsTag } from "@/components/google-analytics-tag";
import "./globals.css";

// Basel — one grotesque for prose, one monospace for machine text.
// Every legacy font variable (--font-spectral / --font-display / --font-geist-sans)
// stays on Archivo. Mono slots (--font-geist-mono / --font-mono-display) resolve
// to IBM Plex Mono so terminals, commands, and status bars render true fixed-width.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  style: ["normal", "italic"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "OpenScout — Local Agent Broker",
  metadataBase: new URL("https://openscout.app"),
  description:
    "Broker-backed local communication and execution for AI agents. Durable conversations, explicit invocations, tracked flights, bridges, a native Mac app, and a local web dashboard.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/openscout-icon.png", type: "image/png", sizes: "1024x1024" },
    ],
    shortcut: ["/favicon.ico"],
    apple: [
      { url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" },
    ],
  },
  openGraph: {
    title: "OpenScout",
    description: "Your local agent broker. Durable conversation, work, routing, and bridges for AI agents.",
    url: "https://openscout.app",
    siteName: "OpenScout",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "OpenScout — Your local agent broker.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "OpenScout",
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
        className={`${archivo.variable} ${ibmPlexMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <GoogleAnalyticsTag />
      </body>
    </html>
  );
}
