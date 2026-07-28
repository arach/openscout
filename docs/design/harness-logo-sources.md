# Harness logos: official sources, licensing, and a monochrome recommendation

Research only — no code or asset changes made. Scope: the five harnesses in the
landing roster (`landing/openscout.app/src/app/page.tsx:150-156`), rendered today
as 2-letter tiles in `.harness-roster__mark`
(`landing/openscout.app/src/app/globals.css:1818-1831`): a 2rem square, `--site-ink`
background, `--site-ink-contrast` letterforms.

Date of research: 2026-07-27. All asset URLs verified live on that date.

## Summary

| Harness | Official vector source | Monochrome shipped by vendor | Modification allowed | Verdict |
|---|---|---|---|---|
| Claude Code | Anthropic press kit (SVG) | Yes — "One-color" variants | Not stated; one-color is vendor-sanctioned | **Ready** |
| Codex | openai.com/brand (browser only) | Yes (blossom is 1-color) | **No** — permission required, no modification | **Blocked on a call** |
| Cursor | cursor.com/brand zip (SVG) | Effectively — 1 path, 1 fill | Not restricted in published guidance | **Ready** |
| Grok | data.x.ai zip (browser only) | Unknown (zip not retrievable headless) | **No** — "exactly as provided, without any alteration" | **Conflicts with the design** |
| pi | pi.dev/logo.svg | Yes — single-color by construction | MIT repo, no trademark policy | **Ready** |

Two of five (Codex, Grok) carry "no modification / prior permission" language. That is
the whole decision: a uniform knocked-out glyph row is not compatible with Grok's
guidelines as written, and is questionable for Codex.

## 1. Claude Code — Anthropic

- **Canonical source:** <https://www.anthropic.com/press-kit> → 307 redirect →
  `https://www-cdn.anthropic.com/ae59ca4ca194dac9c9dc3bc78c5829468cb0e8af.zip`
  (26.5 MB, "Anthropic media resources", logo folders stamped Jan 2026).
  Note `anthropic.com/brand` 404s and `claude.com/brand` does not exist — the press
  kit is the only first-party asset drop.
- **Claude Code has its own official logo.** In the zip:
  `Anthropic logos/Claude logos/2 Claude Code logo/SVG/Claude Code logo - {Slate,Ivory,One-color}.svg`
  — a horizontal lockup, `viewBox="0 0 14552 2000"`, 11 paths: the Claude spark glyph
  (leftmost, x 0–1896) plus a "Claude Code" wordmark. The One-color variant is a single
  `fill` class, i.e. Anthropic ships a sanctioned monochrome form.
- **Square glyph options in the same kit:**
  - `3 Claude Spark/SVG/Claude Spark - Clay.svg` — 94×94, **one path**, `fill="#D97757"`.
    This is the standalone symbol and the right pick for a 2rem tile.
  - `4 Claude icon/SVG/ClaudeIcon-{Square,Rounded}.svg` — 128×128 app icon (spark on a
    clay plate with a gradient); not suitable for a knockout tile.
  - `1 Claude logo/SVG/Claude logo - One-color.svg` — 9156×2000 spark + "Claude" wordmark.
- **Constraints:** the press kit ships no usage PDF. The governing language is
  Anthropic's consumer terms: *"You may not, without our prior written consent, use our
  name, logo, or other trademarks to promote products or services other than the
  Services, or in any other way that implies our affiliation, endorsement, or
  sponsorship."* Nominative use ("Scout works with Claude Code") is the defensible
  framing; a badge that reads as a partnership is not.
- **Caveat:** the standalone Spark is only shipped in Clay. Rendering it in
  `currentColor` is technically a color change, though Anthropic's own kit publishes
  One-color lockups, so monochrome usage is clearly within their idiom.
- **CC0 fallback:** simple-icons `claude` and `anthropic` (`cdn.simpleicons.org/claude`,
  CC0-1.0 for the icon file; trademarks still belong to Anthropic).

## 2. Codex — OpenAI  ⚠️ ambiguous identity

**Codex has no standalone symbol of its own.** Verified from three first-party artifacts:

1. VS Code Marketplace extension `openai.chatgpt`, "Codex – OpenAI's coding agent" —
   publisher `openai`, i.e. first-party. Its icon is the **OpenAI blossom**, white on
   black, 385×385 PNG:
   `https://openai.gallerycdn.vsassets.io/extensions/openai/chatgpt/26.5721.30844/1784862637399/Microsoft.VisualStudio.Services.Icons.Default`
2. Codex CLI splash (`openai/codex` → `.github/codex-cli-splash.png`): the product
   identifies itself typographically as `>_ OpenAI Codex`. No symbol.
3. `developers.openai.com/codex` serves only functional UI icons
   (`/images/codex/icons/*.svg`) plus the site lockup `/OpenAI_Developers.svg`
   (211×22 wordmark). No Codex mark.

- **Vector source:** <https://openai.com/brand> holds the brand kit, but the whole
  `openai.com` / `chatgpt.com` origin returns 403 to non-browser clients (Cloudflare) —
  a human has to download it in a browser. The `openai` icon has also been **removed
  from simple-icons** (`cdn.simpleicons.org/openai` → 404), which is a signal in itself;
  don't route around the brand kit with a community set.
- **Constraints (strictest published set of the five):** permission is required to use
  the logo; you may not modify it; you may not display it more prominently than your own
  mark; you may not imply you are created, supported, certified, endorsed by, or
  partnering with OpenAI; model/product names may not appear in app titles. Contact:
  `partnercomms@openai.com`.
- **Call needed:** either (a) use the OpenAI blossom for the Codex slot — accurate, but
  it is OpenAI's corporate mark and it must be used unmodified, or (b) keep a
  typographic mark for Codex. `>_` is attractive: it is how the CLI presents itself, it
  matches the landing's terminal register, and it carries no trademark exposure.

## 3. Cursor — Anysphere

- **Canonical source:** <https://cursor.com/brand> → "Download brand assets" →
  `https://ptht05hbb1ssoooe.public.blob.vercel-storage.com/assets/brand/cursor-brand-assets.zip`
  (1.9 MB, Sep 2025). Downloads cleanly headless.
- **Best asset for the tile:** `General Logos/Cube/SVG/CUBE_2D_LIGHT.svg`
  (466.73×532.09, **one path**, `fill:#26251E`) and its dark twin `CUBE_2D_DARK.svg`
  (`fill:#EDECEC`). Single path + single fill → a drop-in `currentColor` swap with no
  editing of geometry.
- Also in the zip: `CUBE_25D.svg`, `Wordmark/SVG/WORDMARK_{LIGHT,DARK}.svg`, horizontal
  and vertical lockups (2D and 2.5D), app icons, avatars (including `2D_WHITE`).
- **Published rules:** 2D is the default and 2.5D is for larger applications; horizontal
  lockup preferred; naming — *"Refer to us as Cursor. Not Cursor AI or Cursor Code."*
  The brand page publishes no trademark restrictions, no permission requirement, and no
  prohibition on recoloring.
- **CC0 fallback:** simple-icons `cursor`.

## 4. Grok — xAI  ⚠️ licensing conflicts with the design

- **Which product:** Scout's `grok` harness is xAI's **official Grok CLI**
  (`curl -fsSL https://x.ai/cli/install.sh | bash`; the local install is
  `~/.grok/downloads/grok-0.2.112-macos-aarch64`, README: "A terminal-based AI coding
  assistant and agentic harness"). So the correct mark is the Grok product mark, not a
  third-party CLI's.
- **Canonical source:** <https://x.ai/legal/brand-guidelines> (dated Feb 14, 2025),
  "Download Logos" → **`https://data.x.ai/logos/SpaceXAI_Grok_Assets.zip`**.
  The zip and the guidelines page both 403 to scripted clients (Cloudflare); the zip
  needs a browser download, so its contents and formats are unverified here.
- **Constraints — the blocking one:** *"By using our logos, you agree to the Usage Terms
  above and further agree to only use our logos exactly as provided at the download link
  below, **without any alteration or adjustment**."* Plus: don't use the marks in an app
  title or domain name; **don't add anything in close proximity to the marks in a way
  that creates an impression of a new mark**; don't imply endorsement; press mentions →
  `legal@x.ai`.
- **Consequence:** recoloring the Grok mark to `currentColor` and knocking it out of an
  ink tile is an alteration, and a uniform 5-up grid of vendor marks arguably reads as
  the "close proximity" case. This logo cannot join a normalized monochrome row without
  departing from the guidelines as written.
- **Brand in flux:** x.ai pages now title as **"SpaceXAI — Creators of Grok"** and the
  asset bundle is named `SpaceXAI_Grok_Assets.zip`. The corporate identity appears to be
  mid-rename, so whatever is shipped may age quickly.
- No simple-icons entry (`cdn.simpleicons.org/grok` → 404).

## 5. pi — Earendil Works  (identity worth confirming, asset is ideal)

- **Which "pi":** the Pi agent harness — <https://pi.dev>, repo
  `github.com/earendil-works/pi` (formerly `badlogic/pi-mono`), npm
  `@earendil-works/pi-coding-agent`. Confirmed against Scout's own usage: the runtime
  resolves a `pi` binary with a `pi_rpc` transport (`packages/runtime/src/local-agents.ts:3858-3859`),
  `arach/pi-scout` installs via `pi install git:…` (pi's extension model), and the local
  machine has `~/.pi/agent/{extensions,sessions,settings.json}` — pi.dev's layout.
- **Official logo:** `https://pi.dev/logo.svg` (800×800, `fill="#fff"`) and
  `https://pi.dev/logo-auto.svg` (same geometry, `prefers-color-scheme` swap between
  `#000` and `#fff`). It is a blocky "P" plus an i-dot — **two straight-line paths, no
  curves, no gradients**, already single-color. It is also the mark used in the repo
  README. This is the easiest of the five to adopt and it sits naturally next to the
  landing's flat geometric idiom.
- **Licensing:** repo is MIT (covers code; logos are conventionally out of scope for a
  code license). No trademark or brand policy is published. Low risk, small project — a
  courtesy heads-up in their Discord/issues is cheap insurance if we want to be careful.
- **Ambiguity to flag:** "pi" collides with **omp / oh-my-pi** (`omp.sh`,
  `can1357/oh-my-pi`), which is itself a fork of Pi and ships as the `omp` binary with a
  different identity. If the roster entry means the pi.dev harness — which the code says
  it does — pi.dev's mark is correct and omp's is not.

## Recommendation for local monochrome assets

**Shape of the work (when we do it):**

- Store normalized glyphs at `landing/openscout.app/public/harness/{claude,codex,cursor,grok,pi}.svg`.
- One path (or a small union) per file, square viewBox, `fill="currentColor"`, no
  embedded hex, no gradients, no `<style>` blocks.
- Render inside the existing `.harness-roster__mark` tile. The tile already sets
  `color: var(--site-ink-contrast)` over `background: var(--site-ink)`, so a
  `currentColor` glyph inherits the knockout for free — no CSS restructuring, just swap
  the text node for an `<svg>` and set a size (~14–16px inside the 32px tile) plus
  `aria-hidden="true"`, keeping the harness name as the accessible label.
- Per harness: Claude Code → **Claude Spark** (94×94, one path — not the wordmark
  lockup); Cursor → **CUBE_2D** (one path); pi → **pi.dev logo** (two paths);
  Codex → OpenAI blossom **or** `>_`; Grok → see below.

**The honest constraint:** three of five (Claude Code, Cursor, pi) can be normalized to
monochrome comfortably. Codex requires permission and forbids modification. Grok forbids
alteration outright. A row where two tiles are full-color-as-supplied and three are
knocked-out ink will look broken — that inconsistency is a design cost, not a detail.

Three coherent options, in the order I'd argue for them:

1. **Keep the letterform tiles, add a separate "works with" strip.** The current
   `CL / CX / CU / GR / π` row is already on-brand for the Basel/paper-ink system and
   carries zero trademark exposure. If we want real logos, show them once, larger,
   as-supplied, in a dedicated band where "exactly as provided" is satisfiable. Cheapest
   and safest, and the roster stays typographically uniform.
2. **Glyph row with a Grok exception.** Ship Claude Spark / Cursor cube / pi mark
   monochrome, use the OpenAI blossom for Codex (unmodified, one-color already), and
   render Grok's supplied asset as-is at tile size on a neutral plate. Best-looking if
   the Grok plate can be made to not look like a bug.
3. **Ask.** Email `legal@x.ai` for permission to render Grok's mark one-color, and
   `partnercomms@openai.com` for the Codex/OpenAI mark. Slow, but it is the only path to
   a fully uniform logo row that is also compliant.

**Regardless of option:** add a footer line such as *"Product names and logos are the
property of their respective owners; use here is nominative and does not imply
endorsement."* and keep every mark's prominence at or below OpenScout's own — that is an
explicit OpenAI requirement and a good default for the rest.

## Verified asset URLs (for whoever implements)

```
Anthropic press kit  https://www.anthropic.com/press-kit
                     → https://www-cdn.anthropic.com/ae59ca4ca194dac9c9dc3bc78c5829468cb0e8af.zip
Cursor brand assets  https://ptht05hbb1ssoooe.public.blob.vercel-storage.com/assets/brand/cursor-brand-assets.zip
Grok/xAI assets      https://data.x.ai/logos/SpaceXAI_Grok_Assets.zip   (browser download only, 403 headless)
pi logo              https://pi.dev/logo.svg   ·   https://pi.dev/logo-auto.svg
OpenAI brand kit     https://openai.com/brand                            (browser download only, 403 headless)
Codex ext icon (PNG) https://openai.gallerycdn.vsassets.io/extensions/openai/chatgpt/26.5721.30844/1784862637399/Microsoft.VisualStudio.Services.Icons.Default
```

Downloaded copies of the Anthropic and Cursor kits, the pi logos, and the Codex
extension icon are in this session's scratchpad; they were deliberately **not** added to
the repo, since asset selection depends on the option chosen above.
