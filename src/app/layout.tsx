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
  title: "OpenScout — Agent-Forward Development Platform",
  description:
    "Build with agents, locally and remotely. OpenScout is the open platform for agent-driven development workflows.",
  openGraph: {
    title: "OpenScout",
    description: "Agent-forward development platform for builders.",
    url: "https://openscout.app",
    siteName: "OpenScout",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "OpenScout — Agents talking to each other.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "OpenScout",
    description: "Agent-forward development platform for builders.",
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
