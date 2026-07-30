import type { Metadata } from "next";
import { ThemeProvider } from "hudsonkit/theme";
import { getHudsonThemeScript } from "hudsonkit/theme-script";
// Token sheet only — full `hudsonkit/styles` is a prebuilt Tailwind bundle
// that collides with this app's `@tailwind base` pipeline. Tokens give us
// --hud-* + theme/template attribute rules without re-injecting base CSS.
import "hudsonkit/styles/tokens.css";
import "./theme-aliases.css";
import "./globals.css";
import "./scout-skins.css";
import { StudioShell } from "@/components/StudioShell";
import { listPlans, plansToStudioPages } from "@/lib/plans";
import { engDocsToStudioPages, listEngDocs } from "@/lib/eng-docs";
import { studyMtimes } from "@/lib/study-mtimes";

export const metadata: Metadata = {
  title: "OpenScout Studio",
  description:
    "Internal design + planning studio for OpenScout. Plans, design studies, and a live atom gallery.",
};

/** Keep the legacy openscout-studio:theme key so existing preferences survive. */
const THEME_STORAGE_KEY = "openscout-studio:theme";

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
  const mtimes = studyMtimes();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Pre-paint: sets data-hudson-theme before CSS evaluates (no FOUC). */}
        <script
          dangerouslySetInnerHTML={{
            __html: getHudsonThemeScript({
              defaultTheme: "dark",
              defaultTemplate: "hudson",
              storageKey: THEME_STORAGE_KEY,
            }),
          }}
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        {/* Workmanlike stack — Inter Tight for display (headings only: it is
         *  the display cut), Inter for reading body, JetBrains Mono for
         *  chrome. No display/futuristic face. */}
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Inter+Tight:wght@500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ThemeProvider
          defaultTheme="dark"
          defaultTemplate="hudson"
          storageKey={THEME_STORAGE_KEY}
        >
          <StudioShell extraPages={extraPages} studyMtimes={mtimes}>
            {children}
          </StudioShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
