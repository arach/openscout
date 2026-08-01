import type { SVGProps } from "react";

/**
 * Scout-owned topic glyphs.
 *
 * These are intentionally inline SVG primitives rather than a wrapper around
 * Lucide, SF Symbols, Font Awesome, or an icon font. The same paths can be
 * redrawn in SwiftUI later without taking a third-party icon vocabulary with
 * us into the native app.
 */

export type TopicGlyphId =
  | "comms"
  | "projects"
  | "terminals"
  | "tail"
  | "dispatch"
  | "lanes"
  | "repos"
  | "code"
  | "settings"
  | "appearance"
  | "voice"
  | "notifications"
  | "about"
  | "network"
  | "diagnostics"
  | "broker"
  | "mesh"
  | "web"
  | "peers"
  | "relay"
  | "all"
  | "direct"
  | "channels"
  | "think"
  | "tool"
  | "ask"
  | "message"
  | "note"
  | "boot"
  | "read"
  | "edit"
  | "search"
  | "filter"
  | "columns"
  | "refresh"
  | "pulse";

export type TopicGlyphProps = SVGProps<SVGSVGElement> & {
  size?: number;
  label?: string;
};

const BASE = {
  fill: "none",
  stroke: "currentColor",
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Svg({
  size = 18,
  label,
  children,
  viewBox = "0 0 24 24",
  ...props
}: TopicGlyphProps & { children: React.ReactNode; viewBox?: string }) {
  return (
    <svg
      {...BASE}
      {...props}
      width={size}
      height={size}
      viewBox={viewBox}
      role={label ? "img" : undefined}
      aria-hidden={label ? undefined : true}
    >
      {label ? <title>{label}</title> : null}
      {children}
    </svg>
  );
}

function Comms({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.7}>
    <path d="M3.5 5.5a2 2 0 0 1 2-2h8.1a2 2 0 0 1 2 2v4.1a2 2 0 0 1-2 2H9l-3.8 3v-3H5.5a2 2 0 0 1-2-2z" />
    <path d="M11.2 11.6h4.1a2 2 0 0 1 2 2v2.9a2 2 0 0 1-2 2h-.8v2l-2.9-2H9.7" opacity=".55" />
  </Svg>;
}

function Projects({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.7}>
    <rect x="3" y="4" width="13" height="7" rx="1.6" />
    <rect x="8" y="8" width="13" height="7" rx="1.6" opacity=".68" />
    <path d="M5.5 15v2.1A1.9 1.9 0 0 0 7.4 19h10.1" opacity=".55" />
  </Svg>;
}

function Terminals({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.7}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="m7 9 3 3-3 3M13 15h4" />
  </Svg>;
}

function Tail({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.7}>
    <rect x="3" y="3.5" width="18" height="17" rx="2" />
    <path d="M7 8h.1M10 8h7M7 12h.1M10 12h7M7 16h.1M10 16h5" />
  </Svg>;
}

function Pulse({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.7}>
    <path d="M2.5 12h4l1.8-5 3.1 9 2.2-6 1.6 2h6.3" />
  </Svg>;
}

function Dispatch({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.7}>
    <path d="m3.3 11.7 17-7.2-4.6 14-4.1-5.1z" />
    <path d="m11.6 13.4 8.7-8.9M4.2 11.3l6.8 2.1" opacity=".7" />
  </Svg>;
}

function Lanes({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.7}>
    <rect x="3" y="4" width="4" height="16" rx="1.3" />
    <rect x="10" y="4" width="4" height="16" rx="1.3" />
    <rect x="17" y="4" width="4" height="16" rx="1.3" />
  </Svg>;
}

function Repos({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.7}>
    <circle cx="6" cy="5" r="2" />
    <circle cx="6" cy="19" r="2" />
    <circle cx="18" cy="8" r="2" />
    <path d="M6 7v10M6 12h7a5 5 0 0 0 5-5V6" />
  </Svg>;
}

function Code({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.8}>
    <path d="m8 5-5 7 5 7M16 5l5 7-5 7M14 3l-4 18" />
  </Svg>;
}

function Settings({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.7}>
    <path d="M3 7h18M3 17h18" />
    <circle cx="9" cy="7" r="2" />
    <circle cx="15" cy="17" r="2" />
  </Svg>;
}

function Appearance({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.7}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 3.5v17" />
    <path d="M12 3.5a8.5 8.5 0 0 1 0 17" opacity=".45" />
  </Svg>;
}

function Voice({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.7}>
    <rect x="8" y="3" width="8" height="12" rx="4" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8.5 21h7" />
  </Svg>;
}

function Notifications({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.7}>
    <path d="M5 17h14l-1.7-2.4V10a5.3 5.3 0 0 0-10.6 0v4.6z" />
    <path d="M10 19.5a2.3 2.3 0 0 0 4 0" />
  </Svg>;
}

function About({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.7}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 10.5v5M12 7.5h.1" />
  </Svg>;
}

function Network({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.7}>
    <circle cx="5" cy="12" r="2.2" />
    <circle cx="18" cy="5" r="2.2" />
    <circle cx="18" cy="19" r="2.2" />
    <path d="m7 11 9-5M7 13l9 5" />
  </Svg>;
}

function Diagnostics({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.7}>
    <path d="m14.5 4.2 2.2 2.2-7.9 7.9-3.4 1.1 1.1-3.4z" />
    <path d="m13.3 5.4 2.2 2.2M4 20h7" />
  </Svg>;
}

function Broker({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.6}>
    <circle cx="12" cy="12" r="2.4" />
    <circle cx="12" cy="3.8" r="1.7" />
    <circle cx="20.2" cy="12" r="1.7" />
    <circle cx="12" cy="20.2" r="1.7" />
    <circle cx="3.8" cy="12" r="1.7" />
    <path d="M12 5.5v4M14.4 12h4M12 14.4v4M9.6 12h-4" />
  </Svg>;
}

function Mesh({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.6}>
    <path d="m12 4 8 14H4z" />
    <circle cx="12" cy="4" r="1.8" fill="currentColor" stroke="none" />
    <circle cx="4" cy="18" r="1.8" fill="currentColor" stroke="none" />
    <circle cx="20" cy="18" r="1.8" fill="currentColor" stroke="none" />
  </Svg>;
}

function Web({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.5}>
    <circle cx="12" cy="12" r="9" />
    <ellipse cx="12" cy="12" rx="4" ry="9" />
    <path d="M3 12h18M4.3 8h15.4M4.3 16h15.4" />
  </Svg>;
}

function Peers({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.7}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 6.5a2.5 2.5 0 0 1 0 5M16 14.5a4.2 4.2 0 0 1 4.5 4.5" opacity=".7" />
  </Svg>;
}

function Relay({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.7}>
    <circle cx="4" cy="12" r="2" />
    <circle cx="20" cy="12" r="2" />
    <path d="M6.5 12h11M13.5 8.5 17 12l-3.5 3.5" />
  </Svg>;
}

function All({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.7}>
    <path d="M4 8h16v10H4zM6 8V5h12v3M8 12h8M8 15h5" />
  </Svg>;
}

function Direct({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.7}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="9.5" r="2.2" />
    <path d="M7.8 17a4.3 4.3 0 0 1 8.4 0" />
  </Svg>;
}

function Channels({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.8}>
    <path d="M9 4 7 20M17 4l-2 16M4 9h16M3 15h16" />
  </Svg>;
}

function Think({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.6}>
    <path d="M8 17.5h8M9 20h6M7 14.5a6 6 0 1 1 10 0c-.8.6-1 1.2-1 2H8c0-.8-.2-1.4-1-2Z" />
    <path d="M12 2v2M4.9 4.9l1.4 1.4M19.1 4.9l-1.4 1.4" opacity=".65" />
  </Svg>;
}

function Tool({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.7}>
    <path d="m14.5 4.5 2 2-7.5 7.5-3.4 1.1 1.1-3.4zM4 20h7" />
  </Svg>;
}

function Ask({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.7}>
    <path d="M4 5.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-4.5 3v-3H6a2 2 0 0 1-2-2z" />
    <path d="M9.7 8.5a2.3 2.3 0 1 1 3.5 1.9c-.8.5-1.2.9-1.2 1.6M12 14h.1" />
  </Svg>;
}

function Message({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.7}>
    <path d="M4 5h16v11H9l-5 3z" />
  </Svg>;
}

function Note({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.7}>
    <path d="M6 3.5h9l3 3v14H6zM15 3.5v4h3M9 12h6M9 15h4" />
  </Svg>;
}

function Boot({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.7}>
    <path d="M12 3v9M7.2 5.6a7 7 0 1 0 9.6 0" />
  </Svg>;
}

function Read({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.7}>
    <path d="M2.5 12s3-5 9.5-5 9.5 5 9.5 5-3 5-9.5 5-9.5-5-9.5-5z" />
    <circle cx="12" cy="12" r="2" />
  </Svg>;
}

function Edit({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.7}>
    <path d="m15.5 4.5 4 4L8 20H4v-4zM13 7l4 4" />
  </Svg>;
}

function Search({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.7}>
    <circle cx="10.5" cy="10.5" r="6" />
    <path d="m15 15 5 5" />
  </Svg>;
}

function Filter({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.7}>
    <path d="M3 5h18l-7 8v5l-4 2v-7z" />
  </Svg>;
}

function Columns({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.7}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16M15 4v16" />
  </Svg>;
}

function Refresh({ size, label }: TopicGlyphProps) {
  return <Svg size={size} label={label} strokeWidth={1.8}>
    <path d="M20 6v5h-5M4 18v-5h5" />
    <path d="M5.2 9a7 7 0 0 1 11.9-2L20 11M4 13l2.9 4a7 7 0 0 0 11.9-2" />
  </Svg>;
}

const GLYPHS: Record<TopicGlyphId, (props: TopicGlyphProps) => React.ReactNode> = {
  comms: Comms,
  projects: Projects,
  terminals: Terminals,
  tail: Tail,
  dispatch: Dispatch,
  lanes: Lanes,
  repos: Repos,
  code: Code,
  settings: Settings,
  appearance: Appearance,
  voice: Voice,
  notifications: Notifications,
  about: About,
  network: Network,
  diagnostics: Diagnostics,
  broker: Broker,
  mesh: Mesh,
  web: Web,
  peers: Peers,
  relay: Relay,
  all: All,
  direct: Direct,
  channels: Channels,
  think: Think,
  tool: Tool,
  ask: Ask,
  message: Message,
  note: Note,
  boot: Boot,
  read: Read,
  edit: Edit,
  search: Search,
  filter: Filter,
  columns: Columns,
  refresh: Refresh,
  pulse: Pulse,
};

export function TopicGlyph({ id, ...props }: TopicGlyphProps & { id: TopicGlyphId }) {
  const Glyph = GLYPHS[id];
  return <Glyph {...props} />;
}
