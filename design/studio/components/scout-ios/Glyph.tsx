// Scout iOS — hand-drawn glyph set.
//
// Thin-line, single-weight marks on a 0…24 grid, recreating the app's unified
// `GlyphShape` set (apps/ios/Scout/Glyphs.swift). No SF Symbols, no emoji.
// Shared by every scout-ios study surface + the phone chrome.

export type GlyphKind =
  | "home" | "agent" | "agents" | "comms" | "terminal" | "plus" | "inbox"
  | "chevron" | "arrow" | "gear" | "folder" | "check" | "signal" | "search" | "pulse";

export function Glyph({ kind, size = 18, rotate = 0 }: { kind: GlyphKind; size?: number; rotate?: number }) {
  const sw = Math.max(1, size * (1.5 / 24));
  const common = {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: "currentColor", strokeWidth: sw, strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    style: rotate ? { transform: `rotate(${rotate}deg)` } : undefined,
  };
  switch (kind) {
    case "home": // four rounded tiles — a 2×2 dashboard
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7.75" height="7.75" rx="1.9" />
          <rect x="13.25" y="3" width="7.75" height="7.75" rx="1.9" />
          <rect x="3" y="13.25" width="7.75" height="7.75" rx="1.9" />
          <rect x="13.25" y="13.25" width="7.75" height="7.75" rx="1.9" />
        </svg>
      );
    case "agent": // one figure: head + shoulder arc
      return (
        <svg {...common}>
          <ellipse cx="12" cy="7.9" rx="3.2" ry="3.2" />
          <path d="M5.3 19.3Q12 12.4 18.7 19.3" />
        </svg>
      );
    case "agents": // two figures
      return (
        <svg {...common}>
          <ellipse cx="8.6" cy="7.8" rx="2.4" ry="2.4" />
          <path d="M3.6 18.2Q8.6 11.4 13.6 18.2" />
          <ellipse cx="15.6" cy="10" rx="2.6" ry="2.6" />
          <path d="M10.4 20.4Q15.9 13 21.4 20.4" />
        </svg>
      );
    case "comms": // single speech bubble + short tail
      return (
        <svg {...common}>
          <rect x="3.5" y="4.5" width="17" height="11.5" rx="3.4" />
          <path d="M8.5 16L7 20l5.5-4" />
        </svg>
      );
    case "terminal": // window + ›_ prompt
      return (
        <svg {...common}>
          <rect x="2.5" y="4" width="19" height="16" rx="3" />
          <path d="M6.5 10l3 3-3 3M11.5 16h4" />
        </svg>
      );
    case "plus": // rounded square + plus
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="3.6" />
          <path d="M12 9v6M9 12h6" />
        </svg>
      );
    case "chevron": // canonical ›
      return <svg {...common}><path d="M9.5 6l6 6-6 6" /></svg>;
    case "arrow": // canonical →
      return <svg {...common}><path d="M4.5 12h14M13 6.5l5.5 5.5L13 17.5" /></svg>;
    case "gear": // bespoke Scout gear — eight rounded teeth, filleted ring (replaces the lucide "settings" path)
      return (
        <svg {...common}>
          <path d="M9.63 4.95 Q10.69 4.51 10.84 3.37 L10.85 3.29 Q10.99 2.15 12.14 2.15 L11.86 2.15 Q13.01 2.15 13.15 3.29 L13.16 3.37 Q13.31 4.51 14.37 4.95 L15.31 5.34 Q16.37 5.78 17.28 5.08 L17.34 5.03 Q18.25 4.32 19.06 5.14 L18.86 4.94 Q19.68 5.75 18.97 6.66 L18.92 6.72 Q18.22 7.63 18.66 8.69 L19.05 9.63 Q19.49 10.69 20.63 10.84 L20.71 10.85 Q21.85 10.99 21.85 12.14 L21.85 11.86 Q21.85 13.01 20.71 13.15 L20.63 13.16 Q19.49 13.31 19.05 14.37 L18.66 15.31 Q18.22 16.37 18.92 17.28 L18.97 17.34 Q19.68 18.25 18.86 19.06 L19.06 18.86 Q18.25 19.68 17.34 18.97 L17.28 18.92 Q16.37 18.22 15.31 18.66 L14.37 19.05 Q13.31 19.49 13.16 20.63 L13.15 20.71 Q13.01 21.85 11.86 21.85 L12.14 21.85 Q10.99 21.85 10.85 20.71 L10.84 20.63 Q10.69 19.49 9.63 19.05 L8.69 18.66 Q7.63 18.22 6.72 18.92 L6.66 18.97 Q5.75 19.68 4.94 18.86 L5.14 19.06 Q4.32 18.25 5.03 17.34 L5.08 17.28 Q5.78 16.37 5.34 15.31 L4.95 14.37 Q4.51 13.31 3.37 13.16 L3.29 13.15 Q2.15 13.01 2.15 11.86 L2.15 12.14 Q2.15 10.99 3.29 10.85 L3.37 10.84 Q4.51 10.69 4.95 9.63 L5.34 8.69 Q5.78 7.63 5.08 6.72 L5.03 6.66 Q4.32 5.75 5.14 4.94 L4.94 5.14 Q5.75 4.32 6.66 5.03 L6.72 5.08 Q7.63 5.78 8.69 5.34 Z" />
          <circle cx="12" cy="12" r="3.2" />
        </svg>
      );
    case "folder":
      return (
        <svg {...common}>
          <path d="M3 8.5v-2h5.5l2 2" />
          <rect x="3" y="8.5" width="18" height="10.5" rx="2.2" />
        </svg>
      );
    case "check":
      return <svg {...common}><path d="M5 12.8l5 5 9-11.2" /></svg>;
    case "inbox": // a tray with a dipped opening — the universal inbox mark
      return (
        <svg {...common}>
          <path d="M3 13.5h4.2l1.6 2.8h6.4l1.6-2.8H21" />
          <path d="M5.6 5.1 3 11.3v6.1a1.6 1.6 0 001.6 1.6h14.8a1.6 1.6 0 001.6-1.6v-6.1l-2.6-6.2a1.6 1.6 0 00-1.5-1H7.1a1.6 1.6 0 00-1.5 1z" />
        </svg>
      );
    case "pulse": // live tail — an EKG blip on a flat line
      return (
        <svg {...common}>
          <polyline points="2,12 7,12 9.5,12 11,6.5 13.5,17.5 15.5,12 22,12" />
        </svg>
      );
    case "signal": // wi-fi / connection
      return (
        <svg {...common}>
          <circle cx="12" cy="18" r="1" />
          <path d="M9.4 16.4Q12 12.4 14.6 16.4M6.8 15.2Q12 8.4 17.2 15.2M4.3 14Q12 4.6 19.7 14" />
        </svg>
      );
    case "search":
      return <svg {...common}><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l4.5 4.5" /></svg>;
  }
}
