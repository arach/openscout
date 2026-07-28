"use client";

// Scout iOS — Composer: the kit's ONE message composer.
//
// It IS the canonical MessageComposer atom (design/studio/components/
// MessageComposer.tsx ← production packages/web/client/components/
// MessageComposer/), not a phone-shaped copy of it. This file contributes
// nothing but DEFAULTS — no markup of its own — so every phone surface and
// the web atoms page exercise the same contract, and the eventual SwiftUI
// port has one interface to mirror.
//
// Three things make the atom native on the glass, and all three are params or
// tokens — there is no phone-only CSS for the composer:
//   · appearance="pill" — the phone idiom in the contract: a soft capsule, no
//     toolbar tray, 28px controls, one-line body. With no attach and no tools
//     it folds to a single ~44px line (the classic ask box).
//   · tokens — theme.ts rebinds the `--studio-*` vars the atom's Tailwind
//     classes resolve to onto the phone's `--i-*` palette, so it follows
//     Paper / Shipped / Higher-contrast automatically (token bridge there).
//   · layering — the surface, not the composer, decides its layer: the
//     conversation wraps it in the `.iComposer` dock strip, the entry in
//     `.iEntryDock`. Layout stays a surface concern.

import { useState } from "react";
import {
  MessageComposer,
  type MessageComposerProps,
} from "../MessageComposer";
import { RuntimePicker, type RuntimeValue } from "../RuntimePicker";

/** The kit's hand-drawn glyph set has no mic — same stroke voice as <Glyph>.
 *  The composer gets its mic from the atom; this still dresses the terminal
 *  key tray, the New-session mic float and the fleet ask strip. */
export function MicGlyph({ size = 16 }: { size?: number }) {
  const sw = Math.max(1, size * (2.1 / 24));
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
    </svg>
  );
}

/**
 * The atom with the phone's defaults: the pill appearance, a one-line body,
 * attach anchoring the base row, dictation on. Everything is a pass-through
 * param — a surface that wants the runtime chips passes `tools`, a seeded
 * draft passes `defaultValue`, the keyboard-up state passes `autoFocus`.
 * There are no mock-state props, and this wrapper adds no markup.
 *
 * Drop `showAttach` and `tools` and the atom folds to the single-line ask
 * pill — the same idiom, expressed in params.
 */
export function Composer(props: MessageComposerProps) {
  return (
    <MessageComposer
      appearance="pill"
      placeholder="Ask the fleet…"
      rows={1}
      showAttach
      showDictation
      {...props}
    />
  );
}

/**
 * The runtime triplet — harness · model · effort — as ONE control: the
 * RuntimePicker atom (/atoms/runtime-picker). The three facts that decide how
 * a message runs collapse into a single chip (harness as a mark, model as the
 * word, effort as the level) so the toolbar spends its width on the message,
 * not on configuration. Routing is not here: it stays the Steering Loop's
 * correction grammar, not a permanent toolbar control. Stateful so the panel
 * genuinely opens and picks in the studies.
 */
export function RuntimeChip({
  harness = "claude",
  model = "opus",
  effort = "high",
}: Partial<RuntimeValue> = {}) {
  const [value, setValue] = useState<RuntimeValue>({ harness, model, effort });
  return <RuntimePicker value={value} onChange={setValue} variant="rail" placement="up" />;
}
