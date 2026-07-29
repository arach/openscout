/**
 * The port contract — what has to be true for a studio component to actually
 * drop into `packages/web/client`.
 *
 * "Graduated" is a claim about a component's contract. This file is the claim
 * about the *gap between the two trees*, and it is deliberately separate,
 * because the gap is a property of the repo rather than of any one component.
 *
 * The structural fact underneath all of it: `design/studio` is NOT a workspace
 * member. Root `package.json` declares `workspaces: ["apps/*", "packages/*"]`
 * and the studio lives at `design/studio`, outside both globs, with its own
 * `bun install`. There is no import path, symlink or build step connecting the
 * two trees, so "port" means copying a file and repairing it — and the value of
 * this contract is making that repair mechanical rather than a redesign.
 *
 * What makes it mechanical is that both trees already resolve to the same
 * roots. Studio's `--studio-ink` and web's `--ink` are both `var(--hud-ink)`
 * from hudsonkit, a shared dependency of both. The vocabularies differ; the
 * values do not.
 *
 * Precedent: this has already been solved once in production. Repo Watch was
 * ported out of the studio and kept its studio class names, by redefining the
 * studio token vocabulary locally against `--hud-*`. See
 * `packages/web/client/scout/repo-watch/repo-watch.css` — the `.repo-watch-scope`
 * block is the shim, and `client/arc-tailwind.css` already imports that file.
 * The pattern works and is shipping; what is missing is that it is scoped to
 * one view instead of being the design system's front door.
 */

export interface PortStep {
  /** What has to change. */
  title: string;
  /** Why, in one or two sentences. Skippable if the reader is in a hurry. */
  rationale: string;
  /** `mechanical` can be codemodded; `judgment` needs a person. */
  kind: "mechanical" | "judgment";
  /** Concrete before/after where one exists. */
  example?: { from: string; to: string };
}

/**
 * Studio token → web token, and the hudsonkit root both already resolve to.
 * A remap is only safe where `root` is shared; the entries without one are
 * where a port has to make a decision instead of a substitution.
 */
export const TOKEN_MAP: {
  studio: string;
  web: string;
  root?: string;
  note?: string;
}[] = [
  { studio: "--studio-canvas", web: "--bg", root: "--hud-bg" },
  { studio: "--studio-surface", web: "--surface", root: "--hud-surface" },
  {
    studio: "--studio-canvas-alt",
    web: "—",
    note: "No web equivalent; repo-watch derives it as a 60% mix of surface into canvas.",
  },
  { studio: "--studio-ink", web: "--ink", root: "--hud-ink" },
  { studio: "--studio-ink-muted", web: "--muted", root: "--hud-muted" },
  {
    studio: "--studio-ink-faint",
    web: "--dim",
    root: "--hud-dim",
    note: "repo-watch lifts this 16% toward ink — --hud-dim is too low-contrast on near-black for caption-weight text.",
  },
  { studio: "--studio-edge", web: "--border", root: "--hud-border" },
  {
    studio: "--studio-edge-strong",
    web: "—",
    note: "repo-watch collapses it to --studio-edge on purpose: nothing may be brighter than the app hairline.",
  },
  { studio: "--scout-accent", web: "--accent", root: "--hud-accent" },
  { studio: "--scout-accent-soft", web: "—", root: "--hud-accent-soft" },
];

export const PORT_STEPS: PortStep[] = [
  {
    title: "Rewrite `@/` imports to relative paths with explicit extensions",
    kind: "mechanical",
    rationale:
      "Studio's tsconfig maps `@/*` to the studio root. `packages/web/tsconfig.json` declares no such alias — its own files import relatively and include the file extension.",
    example: {
      from: 'import { HarnessMark } from "@/components/HarnessMark";',
      to: 'import { HarnessMark } from "../HarnessMark.tsx";',
    },
  },
  {
    title: 'Drop the `"use client"` directive',
    kind: "mechanical",
    rationale:
      "It is a Next App Router requirement. The web client is a Vite SPA with no RSC boundary and contains zero occurrences of it. Harmless if left, but dead.",
  },
  {
    title: "Bring the token vocabulary, do not translate it",
    kind: "mechanical",
    rationale:
      "Both trees resolve to the same `--hud-*` roots, so a scoped block that redefines `--studio-*` against `--hud-*` is cheaper and less lossy than rewriting every reference — and it keeps the ported component tracking the operator's theme and accent instead of freezing a studio palette. This is exactly what `.repo-watch-scope` does today.",
    example: {
      from: "background: color-mix(in oklab, var(--studio-ink) 7%, transparent);",
      to: "/* unchanged — the scope block supplies --studio-ink */",
    },
  },
  {
    title: "Register the studio color namespace in web's Tailwind theme",
    kind: "judgment",
    rationale:
      "Web runs Tailwind v4 and already scans `./**/*.{ts,tsx}`, so studio utility classes WOULD generate — except `--color-studio-ink` and friends are not declared in the `@theme inline` block of `client/arc-tailwind.css`, so `text-studio-ink` currently emits nothing and the component renders unstyled. Declaring them there is a handful of lines and makes studio markup portable verbatim. The judgment is whether the web client wants a second color vocabulary in its utility namespace, or would rather each port convert its utilities to CSS.",
    example: {
      from: "@theme inline { --color-sidebar: var(--sidebar); … }",
      to: "@theme inline { --color-studio-ink: var(--studio-ink); … }",
    },
  },
  {
    title: "Decide the styling strategy per component, and record it",
    kind: "judgment",
    rationale:
      "Studio components mix Tailwind utilities with a dedicated CSS file; their shipped web counterparts use zero Tailwind and put everything in CSS under an `s-` prefix. Until the previous step is taken, every port pays for that conversion by hand, and hand conversion is where the visual drift actually comes from — not from the tokens.",
  },
  {
    title: "Reconcile the prop contract deliberately, never by overwrite",
    kind: "judgment",
    rationale:
      "Where production already has a copy, it has call sites. A component whose manifest reports `port.status: \"drifted\"` is telling you the two encode different data-flow models, and the drift list says which. Port behaviour first (the things the web copy is missing), styling second.",
  },
];

/** Everything above, minus the prose, for a CLI or an endpoint to print. */
export const PORT_CONTRACT = {
  from: "design/studio",
  to: "packages/web/client",
  sharedRoot: "hudsonkit (--hud-*)",
  workspaceLinked: false,
  precedent: "packages/web/client/scout/repo-watch/repo-watch.css (.repo-watch-scope)",
  steps: PORT_STEPS,
  tokens: TOKEN_MAP,
} as const;
