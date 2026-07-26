"use client";

/**
 * iOS Launch · Everyday Lane — craft reference frame.
 *
 * ONE screen, built to keynote quality, as the material reference the rest of
 * the Everyday lane gets rebuilt against — plus three genuinely different
 * answers to the hardest question on this surface: how does pre-loaded
 * configuration read as CONFIDENCE rather than as clutter?
 *
 * THESIS — "a dispatch slip".
 * The everyday launch surface is the note you are about to hand to your fleet.
 * The paper canvas states what is true; a writing sheet is docked to the
 * keyboard; the keyboard is the call to action. Nothing else.
 *
 * ── The composer is OUR composer ─────────────────────────────────────────
 * The action row is a direct port of `apps/ios/Scout/ComposerKit.swift` +
 * `NewSessionSurface.swift`, re-expressed in the Everyday lane's material:
 *
 *   [+]  ······················  [model token]  [mic]  [ send ]
 *
 *   · "+" attach     — ComposerAttachButton: 30pt circle, inset fill, hairline
 *                      ring, plus glyph, muted ink.
 *   · model token    — NewSessionSurface.modelToken: family name semibold +
 *                      effort secondary + one caret, bordered chip r9.
 *                      Tapping it raises ModelPickerPopover.
 *   · mic then send  — the kit's exact adjacency: dictation sits IMMEDIATELY
 *                      left of the circular send. Send carries the accent fill
 *                      at all times, dimmed until submittable (empty field →
 *                      dim), so it never pops grey→green a beat late.
 *
 * ── Three configuration treatments (?treatment=1|2|3) ────────────────────
 * Chips-in-a-row is a settings form wearing a chip costume. Each treatment
 * below is a different organizing principle, not a restyle:
 *
 *   01 SENTENCE  State it, don't control it. The whole configuration is
 *                prose on the paper canvas — the app telling you where you
 *                are. Values are tappable, but nothing is shaped like a
 *                control. Lowest possible visual weight.
 *
 *   02 MASTHEAD  Different kinds of things get different homes. PLACE
 *                (project · host) is identity, so it becomes a masthead above
 *                the sheet. ENGINE (harness · model · effort) is an execution
 *                detail, so it rides in the composer action row exactly where
 *                our real modelToken lives.
 *
 *   03 MANIFEST  One line, one tap. Everything collapses into a single route
 *                strip at the head of the writing sheet; the full decision set
 *                is one disclosure away — ModelPickerPopover's three numbered
 *                stops, ported into everyday material (see ?treatment=3).
 *
 * No param → all three side by side for comparison.
 *
 * ── Signatures ──────────────────────────────────────────────────────────
 *   1. Warm paper (R>G>B), not iOS clinical cool gray, with a low-amplitude
 *      light gradient so the chrome has real material to blur.
 *   2. Mono microtype in exactly one register: machine facts (paths, ids).
 *   3. The fleet ring — the anchor is a data complication (arc + tabular
 *      numeral), never a letter avatar or an emoji dot.
 *
 * Accent is rationed: state (live dot), capacity (ring arc), action (send +
 * the keyboard's return key). Every mark is an inline filled SF-style glyph —
 * no stroke icon set.
 */

import { useMemo } from "react";
import { DeviceShell } from "@/components/DeviceShell";

const CSS = `
.lcstage{
  --paper:#F4F1EC; --paper-hi:#FCFBF8;
  --sheet:#FFFFFF;
  --ink:#191714; --ink2:#4E4941; --ink3:#8C867C; --ink4:#B6B0A6;
  --hair:rgba(40,34,26,.11);
  --fill:rgba(60,52,40,.055); --fill2:rgba(60,52,40,.09);
  --accent:#0B8A5F; --accent-deep:#076B4A; --accent-soft:rgba(11,138,95,.10);
  --accent-dim:rgba(11,138,95,.17);
  --kbd:#D2D0D4; --key:#FDFDFD; --key-mod:#B4B2B8; --key-ink:#131316;
  --ui:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Inter Tight",system-ui,sans-serif;
  --mono:"JetBrains Mono",ui-monospace,"SF Mono",Menlo,monospace;
  --e-glass:0 0 0 .5px rgba(40,34,26,.07), 0 1px 2.5px rgba(40,34,26,.07);
  --e-key:0 1px 0 rgba(28,24,18,.28);
  min-height:100vh; width:100%;
  background:
    radial-gradient(120% 80% at 22% -6%, #FDFCFA 0%, rgba(253,252,250,0) 62%),
    radial-gradient(90% 70% at 96% 104%, #E4DFD6 0%, rgba(228,223,214,0) 60%),
    linear-gradient(178deg,#F3F0EA 0%,#EDE9E1 100%);
  font-family:var(--ui); color:var(--ink);
  -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
  padding:50px 56px 60px;
}
/* zero-specificity reset (:where) so control classes below still win */
.lcstage :where(button){background:none;border:0;padding:0;font:inherit;color:inherit;
  cursor:default;text-align:inherit}

/* ── page masthead ───────────────────────────────────────────────── */
.lc-head{margin:0 auto 38px}
.lc-eyebrow{font-family:var(--mono);font-size:10px;font-weight:500;letter-spacing:.16em;
  text-transform:uppercase;color:var(--ink3)}
.lc-head h1{margin:9px 0 0;font-size:37px;font-weight:600;letter-spacing:-.028em;
  line-height:1.03;color:var(--ink)}
.lc-head p{margin:11px 0 0;max-width:660px;font-size:14.5px;line-height:1.55;color:var(--ink2)}
.lc-head p b{font-weight:600;color:var(--ink)}

.lc-board{margin:0 auto;display:flex;align-items:flex-start;gap:60px}
.lc-compare{margin:0 auto;display:flex;align-items:flex-start;gap:44px}

/* ── device presentation ─────────────────────────────────────────── */
.lc-stagepad{flex:none;position:relative;padding:8px 0 0;width:412px}
/* The device frame itself is the shared <DeviceShell> (components/DeviceShell);
   only the screen's paper wallpaper stays local. */
.lc-screen{background:var(--paper)}
.lc-wall{position:absolute;inset:0;z-index:0;
  background:
    radial-gradient(78% 46% at 14% 2%, rgba(255,255,255,.92) 0%, rgba(255,255,255,0) 66%),
    radial-gradient(66% 40% at 100% 34%, rgba(214,206,192,.55) 0%, rgba(214,206,192,0) 70%),
    radial-gradient(90% 50% at 50% 100%, rgba(206,198,184,.45) 0%, rgba(206,198,184,0) 66%);}

/* status bar, Dynamic Island and home indicator come from <DeviceShell> */

/* nav — the bar's material extends behind the status bar, iOS-style */
.lc-nav{position:absolute;top:0;left:0;right:0;height:100px;z-index:30;
  padding:56px 20px 0;display:flex;align-items:center;justify-content:space-between;
  background:linear-gradient(180deg,rgba(252,251,248,.72) 0%,rgba(252,251,248,.34) 72%,rgba(252,251,248,0) 100%);
  -webkit-backdrop-filter:blur(18px) saturate(165%);backdrop-filter:blur(18px) saturate(165%)}
.lc-glass{width:36px;height:36px;border-radius:50%;position:relative;flex:none;
  display:flex;align-items:center;justify-content:center;
  background:rgba(255,255,255,.62);box-shadow:var(--e-glass);
  -webkit-backdrop-filter:blur(14px) saturate(180%);backdrop-filter:blur(14px) saturate(180%)}
.lc-anchor svg{position:absolute;inset:0}
.lc-anchor b{font-size:14.5px;font-weight:600;letter-spacing:-.02em;color:var(--ink);
  font-variant-numeric:tabular-nums;line-height:1}
.lc-mic{color:var(--ink2)}

/* body column: context block on paper, writing sheet docked to the keyboard */
.lc-body{position:absolute;top:100px;left:0;right:0;bottom:312px;z-index:10;
  display:flex;flex-direction:column}
.lc-ctx{padding:13px 20px 18px;flex:none}

/* the one calm status line — present in every treatment */
.lc-state{display:flex;align-items:center;gap:7px;font-size:14.5px;letter-spacing:-.012em;
  color:var(--ink2)}
.lc-state b{font-weight:600;color:var(--ink)}
.lc-livedot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--accent);
  box-shadow:0 0 0 3.5px var(--accent-soft)}
.lc-state s{text-decoration:none;color:var(--ink4);padding:0 1px}

/* ── 01 SENTENCE ─────────────────────────────────────────────────────
   The lane's leading candidate, so it carries the most type craft.
   Three ranks, no middle ground: a 15px state clause, a 19px statement
   that is the screen's only display type, a 10.5px mono footnote.
   Affordance = inline tokens (Shortcuts' answer to editable prose): the
   value keeps flowing with the sentence but sits on a soft fill, so it
   reads as tappable without ever becoming a control. No inline chevrons
   — one caret per value is exactly what made this look cluttered. */
.lc-state.lead{font-size:15px;color:var(--ink2)}
.lc-sentence{margin:12px 0 0;font-size:17.5px;line-height:1.6;letter-spacing:-.022em;
  color:var(--ink3)}
.lc-tok{display:inline-block;padding:2px 7px;margin:0 -1px;border-radius:7px;
  background:rgba(60,52,40,.07);color:var(--ink);font-weight:600;white-space:nowrap;
  letter-spacing:-.018em}
.lc-spath{margin:13px 0 0;font-family:var(--mono);font-size:10.5px;letter-spacing:-.01em;
  color:var(--ink4)}
.lc-spath s{text-decoration:none;color:rgba(182,176,166,.7);padding:0 3px}

/* ── 02 MASTHEAD ─────────────────────────────────────────────────── */
.lc-place{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;
  margin-top:12px}
.lc-pmain{display:flex;align-items:center;gap:8px;min-width:0}
.lc-pmain .lcg{color:var(--ink3);flex:none;display:flex}
.lc-pmain h2{margin:0;font-size:23px;font-weight:600;letter-spacing:-.028em;line-height:1.05;
  color:var(--ink);white-space:nowrap}
.lc-pmain .lcv{color:var(--ink4);display:flex;flex:none;margin-left:1px}
.lc-host{display:inline-flex;align-items:center;gap:5px;height:26px;padding:0 9px;flex:none;
  border-radius:8px;background:var(--fill);font-size:12.5px;font-weight:500;color:var(--ink2)}
.lc-host .lcv{color:var(--ink4);display:flex}
.lc-hdot{width:6px;height:6px;border-radius:50%;background:var(--accent);flex:none}
.lc-ppath{margin:5px 0 0 25px;font-family:var(--mono);font-size:10.5px;letter-spacing:-.01em;
  color:var(--ink4)}
.lc-mrule{height:.5px;background:var(--hair);margin:13px 0 11px}

/* ── the writing sheet ───────────────────────────────────────────── */
.lc-sheet{margin-top:auto;flex:none;background:var(--sheet);border-radius:24px 24px 0 0;
  box-shadow:0 -.5px 0 rgba(40,34,26,.09), 0 -16px 32px -18px rgba(40,34,26,.30);
  padding:14px 22px 18px;display:flex;flex-direction:column}
.lc-grab{width:36px;height:5px;border-radius:2.5px;background:rgba(40,34,26,.14);
  margin:0 auto 12px;flex:none}

/* 03 MANIFEST — the collapsed route strip at the head of the sheet */
.lc-routebar{display:flex;align-items:center;gap:10px;height:48px;padding:0 12px;
  border-radius:13px;background:var(--fill);width:100%;text-align:left;
  box-shadow:inset 0 0 0 .5px var(--hair)}
.lc-routebar > .lcg{color:var(--ink3);flex:none;display:flex}
.lc-rt{flex:1;min-width:0;display:block;overflow:hidden}
.lc-rtline{display:block;font-size:13.5px;letter-spacing:-.012em;color:var(--ink2);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lc-rtline b{font-weight:600;color:var(--ink)}
.lc-rtline s{text-decoration:none;color:var(--ink4);padding:0 4px}
.lc-rtpath{display:block;margin-top:3px;font-family:var(--mono);font-size:10px;
  letter-spacing:-.01em;color:var(--ink4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lc-routebar .lcv{color:var(--ink3);flex:none;display:flex}

/* field — one line. The sheet is a dispatch slip, not a document: the task
   is a sentence you say, so the field is sized to a single line and the
   sheet collapses to the height of what it actually holds. */
.lc-field{flex:none;min-height:0;position:relative;display:flex;align-items:center;
  padding:6px 0 2px}
.lc-sheet.t3 .lc-field{min-height:0;padding-top:8px}
.lc-caret{width:2px;height:27px;border-radius:1px;background:var(--accent);margin-top:1px;flex:none}
.lc-ph{margin-left:9px;font-size:25px;font-weight:600;letter-spacing:-.03em;line-height:1.18;
  color:#C8C2B8}

/* composer action row — ComposerKit.swift, in everyday material */
.lc-bar{display:flex;align-items:center;gap:8px;flex:none;padding-top:14px}
.lc-attach{width:30px;height:30px;border-radius:50%;background:rgba(60,52,40,.075);
  color:var(--ink3);box-shadow:inset 0 0 0 .5px rgba(40,34,26,.14);
  display:flex;align-items:center;justify-content:center;flex:none}
/* addressing grammar, in the action row rather than on the keyboard.
   Same inset fill and hairline as "+" so the left cluster reads as one
   family of composer affordances instead of three loose keyboard keys.
   NOT named .lc-ctx — that class already owns the context block above
   the sheet, and reusing it silently reflowed the masthead prose.
   Kept narrow: the row also carries the model token, mic and send, and
   the send button is the first thing to fall off the edge. */
.lc-addr{display:flex;align-items:center;gap:3px;flex:none}
.lc-addrkey{width:26px;height:26px;border-radius:8px;background:rgba(60,52,40,.055);
  box-shadow:inset 0 0 0 .5px rgba(40,34,26,.11);
  display:flex;align-items:center;justify-content:center;
  font-family:var(--mono);font-size:12.5px;font-weight:500;color:var(--ink3);line-height:1}
.lc-barspace{flex:1}
/* the model token — an OUTLINED capsule, not a filled chip: paper fill,
   a crisp 1.5px ink stroke, fully rounded. It is the one control in the
   action row, so it is drawn, not tinted. */
.lc-token{height:30px;padding:0 10px 0 12px;border-radius:999px;background:var(--sheet);
  border:1.5px solid rgba(25,23,20,.86);flex:none;display:flex;align-items:center;gap:5px;
  font-size:12.5px;font-weight:600;letter-spacing:-.01em;color:var(--ink)}
.lc-token em{font-style:normal;font-size:11px;font-weight:500;color:var(--ink3)}
.lc-token .lcv{color:var(--ink3);display:flex;margin-left:1px}
.lc-micbtn{width:36px;height:36px;border-radius:50%;background:rgba(60,52,40,.075);
  color:var(--ink2);box-shadow:inset 0 0 0 .5px rgba(40,34,26,.14);
  display:flex;align-items:center;justify-content:center;flex:none}
.lc-sendbtn{width:32px;height:32px;border-radius:50%;flex:none;color:#fff;
  background:linear-gradient(180deg,#0F9668 0%,var(--accent) 58%,var(--accent-deep) 100%);
  box-shadow:0 1px 2px rgba(6,58,40,.26), inset 0 .5px 0 rgba(255,255,255,.26);
  display:flex;align-items:center;justify-content:center}

/* ── keyboard ────────────────────────────────────────────────────── */
.lc-kbd{position:absolute;left:0;right:0;bottom:0;height:312px;z-index:20;background:var(--kbd);
  box-shadow:0 -.5px 0 rgba(40,34,26,.14)}
.lc-acc{height:46px;display:flex;align-items:center;justify-content:flex-end;
  padding:0 6px;border-bottom:.5px solid rgba(40,34,26,.09)}
.lc-akey{width:34px;height:30px;border-radius:7px;background:var(--key);box-shadow:var(--e-key);
  display:flex;align-items:center;justify-content:center;
  font-family:var(--mono);font-size:14px;font-weight:500;color:var(--ink2);line-height:1}
.lc-akey.g{color:var(--ink3)}
.lc-keys{padding:9px 3px 0}
.lc-krow{display:flex;gap:6px;margin-bottom:11px}
.lc-krow:last-child{margin-bottom:0}
.lc-key{height:44px;border-radius:5.5px;background:var(--key);box-shadow:var(--e-key);
  display:flex;align-items:center;justify-content:center;color:var(--key-ink);
  font-size:22.5px;font-weight:400;line-height:1}
.lc-key.mod{background:var(--key-mod);box-shadow:0 1px 0 rgba(28,24,18,.26)}
.lc-key.mod.lab{font-size:15.5px}
.lc-key.space{font-size:15.5px;color:#4A4A50}
.lc-key.send{background:linear-gradient(180deg,#0F9668 0%,var(--accent) 55%,var(--accent-deep) 100%);
  color:#fff;font-size:15.5px;font-weight:500;letter-spacing:-.005em;
  box-shadow:0 1px 0 rgba(6,58,40,.45), inset 0 .5px 0 rgba(255,255,255,.28)}

/* caption under the device */
.lc-cap{margin:22px 0 0;text-align:center}
.lc-cap .n{font-family:var(--mono);font-size:10px;font-weight:600;letter-spacing:.15em;
  text-transform:uppercase;color:var(--ink2)}
.lc-cap .d{margin-top:6px;font-size:12px;line-height:1.5;color:var(--ink3);
  max-width:330px;margin-left:auto;margin-right:auto}

/* ── lane tokens strip ───────────────────────────────────────────── */
.lc-tokens{flex:1;min-width:0;max-width:648px;padding-top:6px}
.lc-tk-head{font-family:var(--mono);font-size:10px;font-weight:500;letter-spacing:.16em;
  text-transform:uppercase;color:var(--ink3)}
.lc-tk-lede{margin:10px 0 0;max-width:580px;font-size:13px;line-height:1.6;color:var(--ink2)}
.lc-tk-lede b{font-weight:600;color:var(--ink)}
.lc-cols{margin-top:4px;display:grid;grid-template-columns:1fr 1fr;gap:0 40px;align-items:start}
.lc-sec{margin-top:22px;padding-top:11px;border-top:.5px solid rgba(40,34,26,.16)}
.lc-sec > h3{margin:0 0 8px;font-family:var(--mono);font-size:9.5px;font-weight:600;
  letter-spacing:.14em;text-transform:uppercase;color:var(--ink)}
.lc-row{display:flex;align-items:baseline;gap:10px;padding:3px 0;font-size:11.5px;
  line-height:1.5;color:var(--ink2)}
.lc-row dt{flex:none;width:82px;font-size:11px;color:var(--ink3)}
.lc-row dd{margin:0;flex:1;min-width:0}
.lc-row dd b{font-weight:600;color:var(--ink)}
.lc-row code,.lc-mono{font-family:var(--mono);font-size:10px;letter-spacing:-.01em;color:var(--ink2)}
.lc-sw{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;
  vertical-align:-1px;box-shadow:inset 0 0 0 .5px rgba(40,34,26,.28)}
.lc-note{margin-top:10px;padding:9px 11px;border-radius:11px;background:rgba(255,255,255,.66);
  box-shadow:inset 0 0 0 .5px rgba(40,34,26,.10);font-size:11px;line-height:1.55;color:var(--ink2)}
.lc-note b{font-weight:600;color:var(--ink)}
.lc-scale{display:flex;align-items:baseline;gap:10px;padding:4.5px 0;
  border-bottom:.5px solid rgba(40,34,26,.08)}
.lc-scale:last-child{border-bottom:none}
.lc-scale .sp{flex:none;width:82px;color:var(--ink3);font-size:11px}
.lc-scale .sv{flex:1;color:var(--ink);letter-spacing:-.02em;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis}
.lc-scale .sm{flex:none;font-family:var(--mono);font-size:9px;color:var(--ink4)}

/* ── the disclosed picker (03) ───────────────────────────────────── */
.lc-pickwrap{margin-top:26px;padding-top:11px;border-top:.5px solid rgba(40,34,26,.16)}
.lc-pickwrap > h3{margin:0 0 12px;font-family:var(--mono);font-size:9.5px;font-weight:600;
  letter-spacing:.14em;text-transform:uppercase;color:var(--ink)}
.lc-plate{width:352px;background:#fff;border-radius:20px;padding:10px 14px 13px;
  box-shadow:0 0 0 .5px rgba(40,34,26,.06), 0 2px 6px rgba(40,34,26,.06),
    0 24px 44px -20px rgba(40,34,26,.34)}
.lc-pgrab{width:36px;height:4px;border-radius:2px;background:rgba(40,34,26,.14);margin:0 auto 13px}
.lc-stop{margin-bottom:13px}
.lc-stoplab{display:flex;align-items:baseline;gap:7px;margin-bottom:7px;font-family:var(--mono);
  font-size:9px;letter-spacing:.1em;text-transform:uppercase}
.lc-stoplab .n{color:var(--ink4);letter-spacing:.08em}
.lc-stoplab .t{color:var(--ink2);font-weight:600;letter-spacing:.14em}
.lc-stoplab .c{margin-left:auto;color:var(--ink4);text-transform:none;letter-spacing:0}
.lc-hplates{display:flex;gap:8px}
.lc-hplate{width:88px;padding:11px 8px 9px;border-radius:13px;background:var(--fill);
  display:flex;flex-direction:column;align-items:center;gap:8px;
  box-shadow:inset 0 0 0 .5px var(--hair)}
.lc-hplate.on{background:var(--accent-soft);box-shadow:inset 0 0 0 1px rgba(11,138,95,.34)}
.lc-htile{width:42px;height:42px;border-radius:12px;background:#fff;display:flex;
  align-items:center;justify-content:center;font-size:19px;color:var(--ink3);
  box-shadow:inset 0 0 0 .5px var(--hair)}
.lc-hplate.on .lc-htile{color:var(--accent);box-shadow:inset 0 0 0 1px rgba(11,138,95,.30)}
.lc-hplate .lb{font-family:var(--mono);font-size:11px;font-weight:600;color:var(--ink)}
.lc-hplate.on .lb{color:var(--accent-deep)}
.lc-fchips{display:flex;gap:8px}
.lc-fchip{display:inline-flex;align-items:baseline;gap:6px;padding:7px 12px;border-radius:9px;
  background:var(--fill);box-shadow:inset 0 0 0 .5px var(--hair);
  font-family:var(--mono);font-size:11px;font-weight:600;color:var(--ink)}
.lc-fchip .v{font-weight:400;font-size:10px;color:var(--ink4)}
.lc-fchip .df{font-size:8.5px;letter-spacing:.06em;color:var(--ink3);font-weight:500}
.lc-fchip.on{background:var(--accent-soft);box-shadow:inset 0 0 0 1px rgba(11,138,95,.34);
  color:var(--accent-deep)}
.lc-fchip.on .df{color:rgba(7,107,74,.62)}
.lc-track{display:flex;gap:4px;padding:3px;border-radius:10px;background:var(--fill);
  box-shadow:inset 0 0 0 .5px var(--hair)}
.lc-track span{flex:1;text-align:center;padding:7px 0;border-radius:8px;font-family:var(--mono);
  font-size:11px;color:var(--ink3)}
.lc-track span.on{background:#fff;color:var(--accent-deep);font-weight:600;
  box-shadow:0 1px 2px rgba(40,34,26,.10), inset 0 0 0 .5px rgba(11,138,95,.22)}
.lc-pfoot{margin-top:14px;padding-top:11px;border-top:.5px solid var(--hair);
  display:flex;align-items:center;gap:10px}
.lc-psum{flex:1;min-width:0;font-family:var(--mono);font-size:11px;color:var(--ink3);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lc-psum b{color:var(--ink);font-weight:600}
.lc-done{padding:8px 18px;border-radius:10px;font-family:var(--mono);font-size:11px;
  font-weight:700;letter-spacing:.06em;color:#fff;
  background:linear-gradient(180deg,#0F9668 0%,var(--accent) 55%,var(--accent-deep) 100%);
  box-shadow:0 1px 2px rgba(6,58,40,.30), inset 0 .5px 0 rgba(255,255,255,.28)}

/* compare board */
.lc-legend{margin:34px auto 0;display:grid;grid-template-columns:repeat(3,1fr);gap:40px}
`;

/* ── filled, SF-style glyph vocabulary ─────────────────────────────
   Every mark in the frame is drawn here. No stroke icon set: filled
   volumes are what make chrome read as native rather than as a web app
   wearing a phone costume. (Chevrons and the globe keep SF's own stroked
   construction — SF draws those as strokes too.) */

type GlyphProps = { size?: number };

function GSparkle({ size = 13 }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M11.2 2.7a.56.56 0 0 1 1.06 0l1.36 3.86a3.1 3.1 0 0 0 1.88 1.88l3.86 1.36a.56.56 0 0 1 0 1.06l-3.86 1.36a3.1 3.1 0 0 0-1.88 1.88l-1.36 3.86a.56.56 0 0 1-1.06 0l-1.36-3.86a3.1 3.1 0 0 0-1.88-1.88L4.1 10.86a.56.56 0 0 1 0-1.06l3.86-1.36A3.1 3.1 0 0 0 9.84 6.56L11.2 2.7Z" />
      <path d="M18.62 15.5a.38.38 0 0 1 .72 0l.47 1.35c.12.34.39.61.73.73l1.35.47a.38.38 0 0 1 0 .72l-1.35.47c-.34.12-.61.39-.73.73l-.47 1.35a.38.38 0 0 1-.72 0l-.47-1.35a1.16 1.16 0 0 0-.73-.73l-1.35-.47a.38.38 0 0 1 0-.72l1.35-.47c.34-.12.61-.39.73-.73l.47-1.35Z" />
    </svg>
  );
}

function GFolder({ size = 13 }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M2 7.3A3.3 3.3 0 0 1 5.3 4h3.35c1.02 0 1.98.47 2.6 1.28l.72.93c.13.17.33.27.55.27h6.18A3.3 3.3 0 0 1 22 9.78v6.92A3.3 3.3 0 0 1 18.7 20H5.3A3.3 3.3 0 0 1 2 16.7V7.3Z" />
    </svg>
  );
}

function GDisplay({ size = 13 }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M2.4 6A2.6 2.6 0 0 1 5 3.4h14A2.6 2.6 0 0 1 21.6 6v8.6A2.6 2.6 0 0 1 19 17.2H5a2.6 2.6 0 0 1-2.6-2.6V6Z" />
      <path d="M8.6 18.9h6.8a.95.95 0 0 1 0 1.9H8.6a.95.95 0 0 1 0-1.9Z" />
    </svg>
  );
}

/* the route mark — a filled slip/tag, used only by the manifest strip */
function GRoute({ size = 15 }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M3 6.6A3.1 3.1 0 0 1 6.1 3.5h6.02c.82 0 1.6.32 2.19.9l6.28 6.28a3.1 3.1 0 0 1 0 4.38l-6.02 6.02a3.1 3.1 0 0 1-4.38 0L3.9 14.8a3.1 3.1 0 0 1-.9-2.19V6.6Zm4.9.7a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5Z"
      />
    </svg>
  );
}

function GTerminal({ size = 13 }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M2.4 6.4A3.4 3.4 0 0 1 5.8 3h12.4a3.4 3.4 0 0 1 3.4 3.4v11.2a3.4 3.4 0 0 1-3.4 3.4H5.8a3.4 3.4 0 0 1-3.4-3.4V6.4Zm4.42 2.34a1 1 0 0 0-1.34 1.48l2.1 1.9-2.1 1.9a1 1 0 0 0 1.34 1.48l2.94-2.64a1 1 0 0 0 0-1.48L6.82 8.74ZM12.4 15.1a1 1 0 1 0 0 2h4.6a1 1 0 1 0 0-2h-4.6Z"
      />
    </svg>
  );
}

function GMic({ size = 16 }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <rect x="8.9" y="2.1" width="6.2" height="11.6" rx="3.1" />
      <path d="M5.6 10.2a.95.95 0 0 1 1.9 0 4.5 4.5 0 0 0 9 0 .95.95 0 0 1 1.9 0 6.45 6.45 0 0 1-5.45 6.37V20h2.15a.95.95 0 0 1 0 1.9H8.9a.95.95 0 0 1 0-1.9h2.15v-3.43A6.45 6.45 0 0 1 5.6 10.2Z" />
    </svg>
  );
}

function GArrowUp({ size = 15 }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M12 4.2c.32 0 .62.13.84.36l5.9 5.9a1.18 1.18 0 0 1-1.67 1.67L13.18 8.03V19a1.18 1.18 0 0 1-2.36 0V8.03l-3.89 3.9a1.18 1.18 0 1 1-1.67-1.67l5.9-5.9c.22-.23.52-.36.84-.36Z" />
    </svg>
  );
}

function GPlus({ size = 15 }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M12 3.9c.6 0 1.1.5 1.1 1.1v5.9H19a1.1 1.1 0 0 1 0 2.2h-5.9V19a1.1 1.1 0 0 1-2.2 0v-5.9H5a1.1 1.1 0 0 1 0-2.2h5.9V5c0-.6.5-1.1 1.1-1.1Z" />
    </svg>
  );
}

function GChevronDown({ size = 10 }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 8.5 12 15.5 19 8.5" />
    </svg>
  );
}

function GShift({ size = 19 }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M12 3.1c.32 0 .62.13.84.37l6.9 7.4c.62.67.15 1.76-.77 1.76H16.3v4.9c0 .94-.76 1.7-1.7 1.7H9.4a1.7 1.7 0 0 1-1.7-1.7v-4.9H5.03c-.92 0-1.39-1.09-.77-1.76l6.9-7.4c.22-.24.52-.37.84-.37Z" />
    </svg>
  );
}

function GDelete({ size = 21 }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8.86 4.6h9.9A3.24 3.24 0 0 1 22 7.84v8.32a3.24 3.24 0 0 1-3.24 3.24h-9.9c-.9 0-1.76-.37-2.37-1.03l-3.85-4.16a3.24 3.24 0 0 1 0-4.42l3.85-4.16A3.24 3.24 0 0 1 8.86 4.6Zm2.42 4.63a.85.85 0 0 0-1.2 1.2L12.3 12l-2.22 2.22a.85.85 0 0 0 1.2 1.2l2.22-2.22 2.22 2.22a.85.85 0 0 0 1.2-1.2L14.7 12l2.22-2.22a.85.85 0 0 0-1.2-1.2l-2.22 2.22-2.22-2.22Z"
      />
    </svg>
  );
}

function GGlobe({ size = 21 }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="1.5" aria-hidden>
      <circle cx="12" cy="12" r="8.6" />
      <ellipse cx="12" cy="12" rx="3.7" ry="8.6" />
      <path d="M3.7 9.2h16.6M3.7 14.8h16.6" strokeLinecap="round" />
    </svg>
  );
}

function GKeyboardDown({ size = 19 }: GlyphProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M3.4 3.6h17.2a2 2 0 0 1 2 2v7.1a2 2 0 0 1-2 2H3.4a2 2 0 0 1-2-2V5.6a2 2 0 0 1 2-2Zm2.1 2.7a.95.95 0 1 0 0 1.9.95.95 0 0 0 0-1.9Zm3.5 0a.95.95 0 1 0 0 1.9.95.95 0 0 0 0-1.9Zm3.5 0a.95.95 0 1 0 0 1.9.95.95 0 0 0 0-1.9Zm3.5 0a.95.95 0 1 0 0 1.9.95.95 0 0 0 0-1.9Zm3.5 0a.95.95 0 1 0 0 1.9.95.95 0 0 0 0-1.9ZM7.2 10.5a.9.9 0 0 0 0 1.8h9.6a.9.9 0 0 0 0-1.8H7.2Z" />
      <path d="M12 21.6c-.28 0-.55-.11-.75-.31l-2.6-2.6a1.06 1.06 0 0 1 1.5-1.5l1.85 1.85 1.85-1.85a1.06 1.06 0 0 1 1.5 1.5l-2.6 2.6c-.2.2-.47.31-.75.31Z" />
    </svg>
  );
}

/* The fleet ring — the top-left anchor, and the reason there is no avatar
   here. The arc is capacity (3 of 6 working); the numeral is the count.
   Tapping it opens Overview. */
function FleetRing({ working, total }: { working: number; total: number }) {
  const r = 17.2;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, working / total));
  return (
    <button className="lc-glass lc-anchor" type="button"
      aria-label={`${working} of ${total} agents working — open Overview`}>
      <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden>
        <circle cx="18" cy="18" r={r} fill="none" stroke="rgba(40,34,26,.10)" strokeWidth="2.1" />
        <circle cx="18" cy="18" r={r} fill="none" stroke="var(--accent)" strokeWidth="2.1"
          strokeLinecap="round"
          strokeDasharray={`${(c * frac).toFixed(2)} ${c.toFixed(2)}`}
          transform="rotate(-90 18 18)" />
      </svg>
      <b>{working}</b>
    </button>
  );
}

/* ── keyboard ──────────────────────────────────────────────────────
   Drawn to iOS metrics on a 390pt canvas: 3pt side margin, 6pt gutters,
   33pt letter keys, 44pt height, 11pt row gap, modifiers in the darker
   fill, and a tinted `send` return key (UIReturnKeyType .send). */

const ROW1 = ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"];
const ROW2 = ["A", "S", "D", "F", "G", "H", "J", "K", "L"];
const ROW3 = ["Z", "X", "C", "V", "B", "N", "M"];

function Keyboard() {
  return (
    <div className="lc-kbd">
      {/* accessory bar — the addressing grammar moved up into the composer
          action row, so this keeps only the dismiss affordance it owns */}
      <div className="lc-acc">
        <span className="lc-akey g">
          <GKeyboardDown />
        </span>
      </div>

      <div className="lc-keys">
        <div className="lc-krow">
          {ROW1.map((k) => (
            <span key={k} className="lc-key" style={{ width: 33 }}>{k}</span>
          ))}
        </div>
        <div className="lc-krow" style={{ paddingLeft: 19.5, paddingRight: 19.5 }}>
          {ROW2.map((k) => (
            <span key={k} className="lc-key" style={{ width: 33 }}>{k}</span>
          ))}
        </div>
        <div className="lc-krow">
          <span className="lc-key mod" style={{ width: 42 }}><GShift /></span>
          <span style={{ width: 9, flex: "none" }} />
          {ROW3.map((k) => (
            <span key={k} className="lc-key" style={{ width: 33 }}>{k}</span>
          ))}
          <span style={{ width: 9, flex: "none" }} />
          <span className="lc-key mod" style={{ width: 42 }}><GDelete /></span>
        </div>
        <div className="lc-krow">
          <span className="lc-key mod lab" style={{ width: 46 }}>123</span>
          <span className="lc-key mod" style={{ width: 42 }}><GGlobe /></span>
          <span className="lc-key space" style={{ flex: 1 }}>space</span>
          <span className="lc-key send" style={{ width: 92 }}>send</span>
        </div>
      </div>
    </div>
  );
}

/* ── composer action row — ComposerKit.swift in everyday material ───
   "+" attach on the left; on the right the model token (treatment 02
   only — the other treatments relocate it), then dictation, then the
   circular send. Mic sits IMMEDIATELY left of send, as in the kit.
   Send always carries the accent, dimmed while the field is empty. */
function ComposerBar({ withToken }: { withToken: boolean }) {
  return (
    <div className="lc-bar">
      <button className="lc-attach" type="button" aria-label="Attach">
        <GPlus />
      </button>
      <span className="lc-addr">
        <button className="lc-addrkey" type="button" aria-label="Address an agent">@</button>
        <button className="lc-addrkey" type="button" aria-label="Address a channel">#</button>
        <button className="lc-addrkey" type="button" aria-label="Insert a command">/</button>
      </span>
      <span className="lc-barspace" />
      {withToken ? (
        <button className="lc-token" type="button" aria-label="Model: Opus 5, effort Medium">
          Opus 5<em>Medium</em>
          <span className="lcv"><GChevronDown size={9} /></span>
        </button>
      ) : null}
      <button className="lc-micbtn" type="button" aria-label="Dictate">
        <GMic size={15} />
      </button>
      <button className="lc-sendbtn" type="button" aria-label="Start session">
        <GArrowUp size={15} />
      </button>
    </div>
  );
}

/* ── the three configuration treatments ─────────────────────────── */

type Treatment = 1 | 2 | 3;

/* 01 SENTENCE — state it, don't control it. */
function CtxSentence() {
  return (
    <div className="lc-ctx">
      <div className="lc-state lead">
        <span className="lc-livedot" />
        <span><b>3 agents working</b> <s>·</s> all clear</span>
      </div>
      <p className="lc-sentence">
        Working in <span className="lc-tok">openscout</span> on{" "}
        <span className="lc-tok">studio-mac</span>,
        <br />
        with <span className="lc-tok">Claude Code · Opus 5</span>.
      </p>
      <div className="lc-spath">
        ~/dev/openscout <s>·</s> medium effort
      </div>
    </div>
  );
}

/* 02 MASTHEAD — place is identity, engine is an execution detail. */
function CtxMasthead() {
  return (
    <div className="lc-ctx">
      <div className="lc-place">
        <div className="lc-pmain">
          <span className="lcg"><GFolder size={15} /></span>
          <h2>openscout</h2>
          <span className="lcv"><GChevronDown size={11} /></span>
        </div>
        <button className="lc-host" type="button">
          <span className="lc-hdot" />
          studio-mac
          <span className="lcv"><GChevronDown size={9} /></span>
        </button>
      </div>
      <div className="lc-ppath">~/dev/openscout</div>
      <div className="lc-mrule" />
      <div className="lc-state">
        <span className="lc-livedot" />
        <span><b>3 agents working</b> <s>·</s> all clear</span>
      </div>
    </div>
  );
}

/* 03 MANIFEST — the paper carries only the fleet line; the whole route
   collapses into one strip at the head of the sheet. */
function CtxManifest() {
  return (
    <div className="lc-ctx">
      <div className="lc-state">
        <span className="lc-livedot" />
        <span><b>3 agents working</b> <s>·</s> all clear</span>
      </div>
    </div>
  );
}

function RouteStrip() {
  return (
    <button className="lc-routebar" type="button">
      <span className="lcg"><GRoute size={16} /></span>
      <span className="lc-rt">
        <span className="lc-rtline">
          <b>openscout</b> <s>·</s> studio-mac <s>·</s> Claude Opus 5
        </span>
        <span className="lc-rtpath">~/dev/openscout · medium effort</span>
      </span>
      <span className="lcv"><GChevronDown size={11} /></span>
    </button>
  );
}

/* ── the frame ─────────────────────────────────────────────────────── */

function LaunchFrame({ treatment }: { treatment: Treatment }) {
  return (
    <DeviceShell device="iphone" screenClassName="lc-screen">
      <div className="lc-wall" />

      <div className="lc-nav">
        <FleetRing working={3} total={6} />
        <button className="lc-glass lc-mic" type="button" aria-label="Concierge">
          <GMic />
        </button>
      </div>

      <div className="lc-body">
        {treatment === 1 ? <CtxSentence /> : null}
        {treatment === 2 ? <CtxMasthead /> : null}
        {treatment === 3 ? <CtxManifest /> : null}

        <div className={treatment === 3 ? "lc-sheet t3" : "lc-sheet"}>
          <div className="lc-grab" />
          {treatment === 3 ? <RouteStrip /> : null}
          <div className="lc-field">
            <span className="lc-caret" />
            <span className="lc-ph">Describe the task…</span>
          </div>
          <ComposerBar withToken={treatment !== 3} />
        </div>
      </div>

      <Keyboard />
    </DeviceShell>
  );
}

/* ── the disclosed picker — ModelPickerPopover in everyday material ─ */

function PickerPlate() {
  return (
    <div className="lc-plate">
      <div className="lc-pgrab" />

      <div className="lc-stop">
        <div className="lc-stoplab">
          <span className="n">01</span><span className="t">Harness</span>
          <span className="c">2 available</span>
        </div>
        <div className="lc-hplates">
          <div className="lc-hplate on">
            <span className="lc-htile">✳</span>
            <span className="lb">Claude</span>
          </div>
          <div className="lc-hplate">
            <span className="lc-htile">◈</span>
            <span className="lb">Codex</span>
          </div>
        </div>
      </div>

      <div className="lc-stop">
        <div className="lc-stoplab">
          <span className="n">02</span><span className="t">Family</span>
          <span className="c">Claude</span>
        </div>
        <div className="lc-fchips">
          <span className="lc-fchip on">Opus<span className="v">5</span><span className="df">DEFAULT</span></span>
          <span className="lc-fchip">Sonnet<span className="v">4.6</span></span>
          <span className="lc-fchip">Fable<span className="v">alpha</span></span>
        </div>
      </div>

      <div className="lc-stop">
        <div className="lc-stoplab">
          <span className="n">03</span><span className="t">Effort</span>
          <span className="c">applies to Opus 5</span>
        </div>
        <div className="lc-track">
          <span>Auto</span><span>Low</span><span className="on">Medium</span><span>High</span>
        </div>
      </div>

      <div className="lc-pfoot">
        <span className="lc-psum"><b>Claude</b> Opus 5 · Medium</span>
        <span className="lc-done">Done</span>
      </div>
    </div>
  );
}

/* ── lane tokens ───────────────────────────────────────────────────── */

const TREATMENTS: Record<Treatment, { n: string; name: string; principle: string; detail: string }> = {
  1: {
    n: "01",
    name: "Sentence",
    principle: "State it, don't control it.",
    detail:
      "The configuration is prose on the paper canvas — the app telling you where you are, in one voice, in three ranks: a 15px state clause, a 17.5px statement broken to a deliberate two-line rag, a 10.5px mono footnote for the facts that don't deserve a token. Values are inline tokens (the Shortcuts answer to editable prose): they keep flowing with the sentence on a soft fill with no ring and no caret, so they read as tappable without ever becoming controls. Chevrons after each value are exactly what made this read as clutter. The prose states; the one drawn control — the outlined model capsule — lives where controls live, in the composer action row.",
  },
  2: {
    n: "02",
    name: "Masthead",
    principle: "Different kinds of things get different homes.",
    detail:
      "Place and engine are not the same kind of decision, so they stop being the same kind of control. PLACE (project · host) is the session's identity — it becomes a masthead above the sheet, project set as a title with the path in mono beneath and the host as a live-dot token. ENGINE (harness · model · effort) is an execution detail, so it rides in the composer action row, exactly where NewSessionSurface.modelToken lives today.",
  },
  3: {
    n: "03",
    name: "Manifest",
    principle: "One line, one tap.",
    detail:
      "Everything collapses into a single route strip at the head of the writing sheet: the whole route on one line, the machine facts in mono beneath. Confidence comes from compression — one control, one caret, nothing to scan. The full decision set is one disclosure away: ModelPickerPopover's three numbered stops, ported into everyday material.",
  },
};

function Swatch({ hex }: { hex: string }) {
  return <span className="lc-sw" style={{ background: hex }} />;
}

function LaneTokens({ treatment }: { treatment: Treatment }) {
  const t = TREATMENTS[treatment];
  return (
    <div className="lc-tokens">
      <div className="lc-tk-head">Lane tokens · everyday</div>
      <p className="lc-tk-lede">
        The frame is a <b>dispatch slip</b>: the paper states what is true, a
        writing sheet is docked to the keyboard, and the keyboard is the call to
        action. Rebuild the rest of the lane against these values — not against a
        generic grouped-list mock.
      </p>

      <div className="lc-cols">
        <div>
          <div className="lc-sec">
            <h3>
              Treatment {t.n} · {t.name}
            </h3>
            <div className="lc-row">
              <dt>Principle</dt>
              <dd><b>{t.principle}</b></dd>
            </div>
            <div className="lc-note">{t.detail}</div>
          </div>

          <div className="lc-sec">
            <h3>Composer · ComposerKit.swift</h3>
            <dl className="lc-row">
              <dt>Order</dt>
              <dd>
                <code>+</code> attach · spacer · <b>model token</b> ·{" "}
                <b>mic</b> · <b>send</b> — dictation sits immediately left of
                send, as in the kit.
              </dd>
            </dl>
            <dl className="lc-row">
              <dt>Sizes</dt>
              <dd>
                attach <b>30</b>, mic <b>36</b>, send <b>32</b>, token{" "}
                <b>30h / r9</b>. Kit ships mic 40 / send 30; balanced here for a
                light surface.
              </dd>
            </dl>
            <dl className="lc-row">
              <dt>Send state</dt>
              <dd>
                <b>live, not dimmed.</b> <code>canSubmit</code> is{" "}
                <code>!projectPath.isEmpty</code> — a blank prompt legitimately
                opens a fresh session, so a pre-filled project means send is
                armed before you type.
              </dd>
            </dl>
            <dl className="lc-row">
              <dt>Token</dt>
              <dd>
                an <b>outlined capsule</b> — paper fill, 1.5px ink stroke, fully
                rounded; family semibold + effort secondary + one caret. The one
                drawn control in the row (
                <code>NewSessionSurface.modelToken</code>, restyled from the
                dark lane&apos;s filled chip).
              </dd>
            </dl>
            <dl className="lc-row">
              <dt>Focus</dt>
              <dd>The caret is the focus state. No ring, no glow, no border swap.</dd>
            </dl>
          </div>

          <div className="lc-sec">
            <h3>Type · SF, with two ranges only</h3>
            <div className="lc-scale">
              <span className="sp">Prompt</span>
              <span className="sv" style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-.03em" }}>
                Describe…
              </span>
              <span className="sm">25 / 600 / −.03</span>
            </div>
            <div className="lc-scale">
              <span className="sp">Statement</span>
              <span className="sv" style={{ fontSize: 15, letterSpacing: "-.022em" }}>
                Working in <b style={{ fontWeight: 600 }}>openscout</b>
              </span>
              <span className="sm">17.5 / 400·600</span>
            </div>
            <div className="lc-scale">
              <span className="sp">Place title</span>
              <span className="sv" style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-.028em" }}>
                openscout
              </span>
              <span className="sm">23 / 600</span>
            </div>
            <div className="lc-scale">
              <span className="sp">Status line</span>
              <span className="sv" style={{ fontSize: 14.5, letterSpacing: "-.012em" }}>
                3 agents working
              </span>
              <span className="sm">14.5 / 400·600</span>
            </div>
            <div className="lc-scale">
              <span className="sp">Machine fact</span>
              <span className="sv lc-mono" style={{ fontSize: 10.5 }}>~/dev/openscout</span>
              <span className="sm">10.5 mono</span>
            </div>
            <div className="lc-note">
              Contrast, not middle ground: <b>25px tight</b> against{" "}
              <b>10.5px mono</b>, nothing muddy in between. Face is{" "}
              <code>-apple-system</code> (SF Pro) — never a web-UI face in a
              phone frame. Mono is rationed to machine facts: paths, hosts, ids.
            </div>
          </div>
        </div>

        <div>
          <div className="lc-sec">
            <h3>Material · paper, glass, elevation</h3>
            <dl className="lc-row">
              <dt>Canvas</dt>
              <dd>
                <Swatch hex="#F4F1EC" /> <b>warm paper</b> — R&gt;G&gt;B, plus a
                low-amplitude light gradient. Not <code>#F2F2F7</code>.
              </dd>
            </dl>
            <dl className="lc-row">
              <dt>Sheet</dt>
              <dd>
                <Swatch hex="#FFFFFF" /> a presented sheet, not a floating card:
                top corners only, hairline + upward ambient shadow, docked to the
                keyboard.
              </dd>
            </dl>
            <dl className="lc-row">
              <dt>Chrome</dt>
              <dd>
                glass — <code>blur(18px) saturate(165%)</code>, fading to
                transparent at the bar&apos;s edge.
              </dd>
            </dl>
            <dl className="lc-row">
              <dt>Fill</dt>
              <dd>
                <Swatch hex="#F2F0ED" /> <code>rgba(60,52,40,.055)</code> +
                hairline ring — every inset control. Warm-tinted, never neutral
                gray.
              </dd>
            </dl>
            <dl className="lc-row">
              <dt>Keyboard</dt>
              <dd>
                <Swatch hex="#D2D0D4" /> deck · <Swatch hex="#FDFDFD" /> keys ·{" "}
                <Swatch hex="#B4B2B8" /> modifiers, hard{" "}
                <code>0 1px 0 rgba(28,24,18,.28)</code> keycap drop.
              </dd>
            </dl>
          </div>

          <div className="lc-sec">
            <h3>Radius · steps down with the element</h3>
            <dl className="lc-row">
              <dt>Scale</dt>
              <dd>
                screen <b>47.5</b> · sheet <b>24</b> · route strip <b>13</b> ·
                plate <b>20</b> · token <b>9</b> · keycap <b>5.5</b>
              </dd>
            </dl>
            <dl className="lc-row">
              <dt>Rule</dt>
              <dd>
                Roughly ⅓ of the element&apos;s own height — never one shared
                constant, never a pill where a rectangle is honest.
              </dd>
            </dl>
          </div>

          <div className="lc-sec">
            <h3>Accent · rationed</h3>
            <dl className="lc-row">
              <dt>Emerald</dt>
              <dd>
                <Swatch hex="#0B8A5F" /> <code>#0B8A5F</code> →{" "}
                <code>#076B4A</code>
              </dd>
            </dl>
            <div className="lc-note">
              Four appearances, each meaning something different: <b>state</b>{" "}
              (live dot), <b>capacity</b> (fleet ring arc), <b>action</b> (the
              composer send), <b>commit</b>{" "}
              (the keyboard&apos;s return key). Everything else is ink, paper,
              or fill. No categorical color-coding.
            </div>
          </div>

          <div className="lc-sec">
            <h3>Marks · filled, never stroked</h3>
            <dl className="lc-row">
              <dt>Vocabulary</dt>
              <dd>
                Inline SF-style filled volumes — folder, display, terminal,
                sparkle, mic, plus, route, shift, delete.{" "}
                <b>No stroke icon set</b>{" "}
                anywhere in the lane; chevrons and the globe keep SF&apos;s own
                stroked construction.
              </dd>
            </dl>
            <dl className="lc-row">
              <dt>Identity</dt>
              <dd>
                <b>No letter avatars, no emoji dots.</b> The anchor is a data
                complication: an arc that means 3 of 6, over a tabular numeral.
              </dd>
            </dl>
          </div>

          <div className="lc-sec">
            <h3>Signature · what makes it Scout</h3>
            <dl className="lc-row">
              <dt>Paper</dt>
              <dd>Warm canvas, same family as the landing paper/ink system.</dd>
            </dl>
            <dl className="lc-row">
              <dt>Routing</dt>
              <dd>Mono microtype for machine facts, nowhere else.</dd>
            </dl>
            <dl className="lc-row">
              <dt>Fleet ring</dt>
              <dd>Capacity as an arc — the one complication that survives.</dd>
            </dl>
          </div>
        </div>
      </div>

    </div>
  );
}

/* ── page ──────────────────────────────────────────────────────────── */

function readTreatment(): Treatment | null {
  if (typeof window === "undefined") return null;
  const raw = new URLSearchParams(window.location.search).get("treatment");
  if (raw === "1") return 1;
  if (raw === "2") return 2;
  if (raw === "3") return 3;
  return null;
}

export default function IosLaunchCraft() {
  const treatment = useMemo(readTreatment, []);

  if (treatment) {
    const t = TREATMENTS[treatment];
    return (
      <div className="lcstage">
        <style dangerouslySetInnerHTML={{ __html: CSS }} />
        <header className="lc-head" style={{ maxWidth: 1120 }}>
          <div className="lc-eyebrow">
            Scout iOS · everyday lane · launch · treatment {t.n}
          </div>
          <h1>{t.name}</h1>
          <p>
            {t.principle} {t.detail}
          </p>
        </header>
        <div className="lc-board" style={{ maxWidth: 1120 }}>
          <div className="lc-stagepad">
            <LaunchFrame treatment={treatment} />
            <div className="lc-cap">
              <div className="n">
                {t.n} · {t.name} — launch · composer-first · no tab bar
              </div>
            </div>
            {treatment === 3 ? (
              <div className="lc-pickwrap">
                <h3>One tap → the picker · ModelPickerPopover.swift</h3>
                <PickerPlate />
              </div>
            ) : null}
          </div>
          <LaneTokens treatment={treatment} />
        </div>
      </div>
    );
  }

  return (
    <div className="lcstage">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <header className="lc-head" style={{ maxWidth: 1360 }}>
        <div className="lc-eyebrow">Scout iOS · everyday lane · craft reference</div>
        <h1>Launch</h1>
        <p>
          The app opens into the writing surface with the keyboard already up and
          every decision pre-filled from your last task. <b>Zero taps to start,
          one tap to redirect.</b> One frame, three organizing principles for the
          configuration — the question each answers is how pre-loaded context
          reads as confidence rather than clutter. Isolate one with{" "}
          <code style={{ fontFamily: "var(--mono)", fontSize: 12.5 }}>
            ?treatment=1|2|3
          </code>
          .
        </p>
      </header>

      <div className="lc-compare" style={{ maxWidth: 1360 }}>
        {([1, 2, 3] as Treatment[]).map((n) => {
          const t = TREATMENTS[n];
          return (
            <div className="lc-stagepad" key={n}>
              <LaunchFrame treatment={n} />
              <div className="lc-cap">
                <div className="n">
                  {t.n} · {t.name}
                </div>
                <div className="d">{t.principle}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
