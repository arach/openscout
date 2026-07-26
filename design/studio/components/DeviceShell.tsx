/**
 * DeviceShell — the studio's ONE reusable iPhone/iPad device frame.
 *
 * Chrome-free: draws ONLY the device — titanium bezel, rounded screen,
 * Dynamic Island (iPhone portrait), iOS status bar (time left, signal /
 * wifi / battery right), home indicator, bezel shadow. Children render in
 * the screen area; every study keeps its own screen content.
 *
 * The look is the ios-launch-craft keynote shell (gradient titanium bezel,
 * black rim, 390×844pt iPhone canvas); iPad dims follow fleet-led-carousel
 * (1180×820pt, landscape default, portrait supported). Do not confuse this
 * with `components/scout-ios/PhoneShell`, which is bound to the shipped
 * RootView chrome — a different job.
 *
 * Status-bar spec (38px bar, 88×22 island, 22×11 battery) and the chassis
 * shadow recipe follow the Talkie reference — values imported from
 * `lib/talkie-ref.ts`. Sizing stays realistic per the owner directive.
 *
 * ```tsx
 * <DeviceShell device="iphone" scale={0.87}>…screen content…</DeviceShell>
 * <DeviceShell device="ipad" tone="dark" statusBar={false}>…</DeviceShell>
 * ```
 */

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { FRAME as TALKIE_FRAME, STATUS_BAR as TALKIE_SBAR } from "@/lib/talkie-ref";

export type DeviceKind = "iphone" | "ipad";
export type DeviceOrientation = "portrait" | "landscape";
export type DeviceTone = "light" | "dark";

export interface DeviceShellProps {
  device?: DeviceKind;
  /** Default: landscape for iPad, portrait for iPhone. */
  orientation?: DeviceOrientation;
  /** Presentation scale; the layout footprint shrinks with it. Default 1. */
  scale?: number;
  /** Status-bar / home-indicator ink: dark on light screens, light on dark. */
  tone?: DeviceTone;
  /** Status-bar clock. Default "9:41" (keynote time). */
  time?: string;
  /** Default: shown on iPhone portrait only. */
  island?: boolean;
  statusBar?: boolean;
  homeIndicator?: boolean;
  /** Override the screen height (e.g. composer-atlas's cropped specimen). */
  screenHeight?: number;
  className?: string;
  /** Extra class for the screen element (wallpaper, study state classes). */
  screenClassName?: string;
  /** Extra props for the screen element (data-testid, aria, …). */
  screenProps?: HTMLAttributes<HTMLDivElement> & {
    [key: `data-${string}`]: string;
  };
  children?: ReactNode;
}

/* pt dims (1pt = 1px at scale 1) */
const DIMS: Record<
  DeviceKind,
  Record<DeviceOrientation, { w: number; h: number; bezel: number }>
> = {
  iphone: {
    portrait: { w: 390, h: 844, bezel: 11 },
    landscape: { w: 844, h: 390, bezel: 11 },
  },
  ipad: {
    portrait: { w: 820, h: 1180, bezel: 13 },
    landscape: { w: 1180, h: 820, bezel: 13 },
  },
};
const RIM = 2.5;

/* Status-bar + frame-shadow spec adopted from the Talkie reference
 * (see lib/talkie-ref.ts). Our realistic sizing (390×844 screen,
 * titanium bezel) is kept; only the bar/island/battery spec and the
 * chassis shadow recipe are Talkie's. */
const SB = TALKIE_SBAR;

const CSS = `
.dsh-box{position:relative;flex:none}
.dsh-device{position:relative;background:linear-gradient(147deg,#D8D3CB 0%,#A29C92 16%,#E7E3DC 36%,#918B81 60%,#CAC5BC 78%,#9A948A 100%);
  box-shadow:${TALKIE_FRAME.shadow}}
.dsh-rim{padding:${RIM}px;background:#07070A;
  box-shadow:inset 0 0 0 .5px rgba(255,255,255,.14)}
.dsh-screen{position:relative;overflow:hidden;isolation:isolate}
/* default canvas is :where()-weak so a study's screenClassName always wins
   regardless of <style> tag order */
:where(.dsh-screen){background:#fff}
.dsh-island{position:absolute;top:${SB.island.top}px;left:50%;transform:translateX(-50%);
  width:${SB.island.width}px;height:${SB.island.height}px;border-radius:${SB.island.radius}px;
  background:${SB.island.background};z-index:40;pointer-events:none}
.dsh-island i{position:absolute;right:7px;top:50%;transform:translateY(-50%);
  width:5.5px;height:5.5px;border-radius:50%;background:#0B0B10;
  box-shadow:inset 0 0 1.2px rgba(90,96,110,.9)}
.dsh-sbar{position:absolute;top:0;left:0;right:0;height:${SB.height}px;z-index:38;
  display:flex;align-items:center;justify-content:space-between;padding:0 ${SB.paddingX}px;
  pointer-events:none}
.dsh-sbar .dsh-time{font-size:${SB.timeFontSize}px;font-weight:${SB.timeWeight};letter-spacing:-.01em;
  font-variant-numeric:tabular-nums;line-height:1}
.dsh-sigs{display:flex;align-items:center;gap:6px}
.dsh-homeind{position:absolute;bottom:8px;left:50%;transform:translateX(-50%);
  z-index:44;pointer-events:none}
.dsh-tone-light{color:#191714}
.dsh-tone-light .dsh-homeind{background:rgba(10,10,12,.86)}
.dsh-tone-dark{color:rgba(255,255,255,.92)}
.dsh-tone-dark .dsh-homeind{background:rgba(255,255,255,.38)}
`;

function StatusMarks() {
  return (
    <div className="dsh-sigs">
      <svg width="16" height="11" viewBox="0 0 16 11" fill="currentColor" aria-hidden>
        <rect x="0" y="7" width="2.5" height="4" rx="0.5" />
        <rect x="4.5" y="5" width="2.5" height="6" rx="0.5" />
        <rect x="9" y="3" width="2.5" height="8" rx="0.5" />
        <rect x="13.5" y="0" width="2.5" height="11" rx="0.5" />
      </svg>
      <svg
        width="13"
        height="9"
        viewBox="0 0 16 11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        aria-hidden
      >
        <path d="M8 9.5a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8zM4 6.2a5.5 5.5 0 0 1 8 0M2 4a8.5 8.5 0 0 1 12 0" />
      </svg>
      {/* Battery — Talkie StatusBar spec: 22×11, 3px radius, 1px ring,
          phosphor-green fill (#5fc97a) at 76%, nub on the right. */}
      <svg width={SB.battery.width + 3} height={SB.battery.height} viewBox="0 0 25 11" aria-hidden>
        <rect
          x="0.5"
          y="0.5"
          width={SB.battery.width - 1}
          height={SB.battery.height - 1}
          rx={SB.battery.radius}
          fill="none"
          stroke="currentColor"
          strokeOpacity=".4"
        />
        <rect
          x="2"
          y="2"
          width={(SB.battery.width - 4) * 0.76}
          height={SB.battery.height - 4}
          rx="1"
          fill={SB.battery.fill}
        />
        <rect x={SB.battery.width + 0.5} y="3" width="1.5" height="5" rx="0.75" fill="currentColor" fillOpacity=".4" />
      </svg>
    </div>
  );
}

export function DeviceShell({
  device = "iphone",
  orientation,
  scale = 1,
  tone = "light",
  time = "9:41",
  island,
  statusBar = true,
  homeIndicator = true,
  screenHeight,
  className,
  screenClassName,
  screenProps,
  children,
}: DeviceShellProps) {
  const orient: DeviceOrientation =
    orientation ?? (device === "ipad" ? "landscape" : "portrait");
  const dims = DIMS[device][orient];
  const screenW = dims.w;
  const screenH = screenHeight ?? dims.h;
  const showIsland = island ?? (device === "iphone" && orient === "portrait");

  /* radii: chassis → rim → screen each shrink by exactly the padding
     between them (Talkie's screenR = chassisR − bezel rule, applied to
     both our bezel and rim layers). iPhone keeps the launch-craft 60px
     chassis corner; iPad keeps the tighter fleet-led-carousel 40px. */
  const deviceR = device === "iphone" ? 60 : 40;
  const rimR = deviceR - dims.bezel;
  const screenR = rimR - RIM;

  const outerW = screenW + 2 * (dims.bezel + RIM);
  const outerH = screenH + 2 * (dims.bezel + RIM);

  const deviceStyle: CSSProperties = {
    padding: dims.bezel,
    borderRadius: deviceR,
    width: outerW,
    height: outerH,
  };
  const homeIndStyle: CSSProperties =
    device === "iphone"
      ? { width: 139, height: 5, borderRadius: 2.5 }
      : { width: orient === "landscape" ? 220 : 264, height: 4.5, borderRadius: 3 };

  const shell = (
    <div className={`dsh-device dsh-tone-${tone}`} style={deviceStyle}>
      <div className="dsh-rim" style={{ borderRadius: rimR }}>
        <div
          {...screenProps}
          className={["dsh-screen", screenClassName].filter(Boolean).join(" ")}
          style={{
            width: screenW,
            height: screenH,
            borderRadius: screenR,
            ...screenProps?.style,
          }}
        >
          {showIsland ? (
            <div className="dsh-island">
              <i />
            </div>
          ) : null}
          {statusBar ? (
            <div className="dsh-sbar">
              <span className="dsh-time">{time}</span>
              <StatusMarks />
            </div>
          ) : null}
          {children}
          {homeIndicator ? <div className="dsh-homeind" style={homeIndStyle} /> : null}
        </div>
      </div>
    </div>
  );

  return (
    <div
      className={["dsh-box", className].filter(Boolean).join(" ")}
      style={{ width: outerW * scale, height: outerH * scale }}
    >
      <style>{CSS}</style>
      <div
        style={
          scale === 1
            ? undefined
            : { transform: `scale(${scale})`, transformOrigin: "top left" }
        }
      >
        {shell}
      </div>
    </div>
  );
}

export default DeviceShell;
