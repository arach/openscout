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
    case "gear":
      return (
        <svg {...common}>
          <path d="M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 13a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-2.7 1.1V20a2 2 0 11-4 0v-.1A1.6 1.6 0 005 18.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00-1.1-2.7H1a2 2 0 110-4h.1A1.6 1.6 0 002.7 5l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H8a1.6 1.6 0 001-1.5V1a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V8a1.6 1.6 0 001.5 1H23a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z" />
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
