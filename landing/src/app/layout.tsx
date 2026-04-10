import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Instrument_Serif, Fraunces, Spectral } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-display",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
});

const spectral = Spectral({
  variable: "--font-spectral",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "OpenScout — Local Agent Broker",
  metadataBase: new URL("https://openscout.app"),
  description:
    "Broker-backed local communication and execution for AI agents. Durable conversations, explicit invocations, tracked flights, bridges, and a desktop shell.",
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
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} ${fraunces.variable} ${spectral.variable} antialiased bg-background text-foreground`}
      >
        {children}
      </body>
    </html>
  );
}
