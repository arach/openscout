import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css";
import { NextRouterProvider } from "studio/router/next";
import { StudioShell } from "@/components/StudioShell";
import { THEME_BOOTSTRAP_SCRIPT } from "@/components/ThemeToggle";
import { listPlans, plansToStudioPages } from "@/lib/plans";
import { engDocsToStudioPages, listEngDocs } from "@/lib/eng-docs";

export const metadata: Metadata = {
  title: "OpenScout Studio",
  description:
    "Internal design + planning studio for OpenScout. Plans, design studies, and a live atom gallery.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Read plans + eng docs server-side so the sidebar + page strip can
  // show them without a client-side fetch round-trip. Eng docs are
  // read live from `docs/eng/*.md` — never copied.
  const plans = listPlans();
  const engDocs = listEngDocs();
  const extraPages = [
    ...plansToStudioPages(plans),
    ...engDocsToStudioPages(engDocs),
  ];

  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* No-FOUC: read localStorage and set data-theme before any
         *  CSS evaluates. `beforeInteractive` runs the script in <head>
         *  before hydration, equivalent to a raw inline <script> but
         *  via the Next-sanctioned API. */}
        <Script
          id="theme-bootstrap"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        {/* Studio face stack — Play (display), Inter Tight (body),
         *  JetBrains Mono (chrome). Scout proper now also ships Play via
         *  packages/web/client/scout/Provider.tsx (--hud-font-serif). */}
        <link
          href="https://fonts.googleapis.com/css2?family=Play:wght@400;700&family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <NextRouterProvider>
          <StudioShell extraPages={extraPages}>{children}</StudioShell>
        </NextRouterProvider>
      </body>
    </html>
  );
}
