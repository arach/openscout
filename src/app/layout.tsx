import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Instrument_Serif } from "next/font/google";
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

export const metadata: Metadata = {
  title: "OpenScout — Local Agent Control Plane",
  description:
    "A desktop shell and runtime for coordinating AI agents. File-based relay chat, message routing, voice and Telegram bridges — all local-first.",
  openGraph: {
    title: "OpenScout",
    description: "Your local agent control plane. Desktop shell, relay chat, runtime broker, and bridges for AI agents.",
    url: "https://openscout.app",
    siteName: "OpenScout",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "OpenScout — Your local agent control plane.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "OpenScout",
    description: "Your local agent control plane. Desktop shell, relay chat, runtime broker, and bridges for AI agents.",
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
        className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} antialiased bg-background text-foreground`}
      >
        {children}
      </body>
    </html>
  );
}
