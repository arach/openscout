import { registerDevOverride } from "./override.tsx";

/**
 * Dev-only overrides — the "register against this page in dev" manifest.
 *
 * Imported only under `import.meta.env.DEV` (see client/main.tsx), so neither
 * this module nor any override/fixture it pulls in reaches the production
 * bundle. Add a registerDevOverride(<id>, …) call here to inject a design
 * variant over a live region, then load the app with `?override=<id>` to see it.
 *
 * Override ids are shared with the studio catalog (design/studio/lib/studio-pages.ts
 * `StudioStudyTarget`), so a studio study and its live-app region line up by id.
 */

registerDevOverride("agents.directory", () => (
  <section
    className="dev-override-study"
    aria-label="Studio override · agents.directory"
    style={{
      display: "grid",
      gap: 12,
      padding: 24,
      margin: 16,
      borderRadius: 12,
      border: "1px dashed var(--s-border, rgba(127, 127, 127, 0.4))",
      background: "var(--s-surface-raised, rgba(127, 127, 127, 0.06))",
    }}
  >
    <strong style={{ fontSize: 13, letterSpacing: 0.2 }}>
      Studio override · <code>agents.directory</code>
    </strong>
    <span style={{ fontSize: 12, opacity: 0.7, maxWidth: 520 }}>
      Dev-only override. Replaces the live Agents directory while{" "}
      <code>?override=agents.directory</code> is in the URL. Nothing here ships —
      this manifest is excluded from production builds.
    </span>
  </section>
));
