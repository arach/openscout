const OUTER = "50,20 78,36.5 78,63.5 50,80 22,63.5 22,36.5";
const INNER = "50,39 61.5,45.8 61.5,54.2 50,61 38.5,54.2 38.5,45.8";

const MENU_OUTER = "10,4.3 14.8,7.1 14.8,12.9 10,15.7 5.2,12.9 5.2,7.1";
const MENU_INNER = "10,7 12.4,8.4 12.4,10.6 10,12 7.6,10.6 7.6,8.4";

type MenuTreatment = "templateGlyph" | "lightPlate" | "darkPlate";

const MENU_TREATMENTS: {
  id: MenuTreatment;
  label: string;
  note: string;
}[] = [
  {
    id: "templateGlyph",
    label: "Template glyph",
    note: "Recommended for the native menu item and dark headers. macOS supplies contrast, and the silhouette stays Scout instead of becoming a tiny tile.",
  },
  {
    id: "lightPlate",
    label: "Light plate",
    note: "Readable on blue, but the plate becomes the shape and makes the mark feel generic.",
  },
  {
    id: "darkPlate",
    label: "Dark plate",
    note: "Useful as an app icon texture, not as chrome. On black surfaces it sinks into the background.",
  },
];

function CubeMark({
  stroke = 3.9,
  compact = false,
  ink = "#fff7ea",
  dim = "#bdb5a8",
}: {
  stroke?: number;
  compact?: boolean;
  ink?: string;
  dim?: string;
}) {
  return (
    <g fill="none" strokeLinecap="round" strokeLinejoin="round">
      <polygon points={OUTER} stroke={ink} strokeWidth={stroke} />
      {!compact && (
        <>
          <line x1="50" y1="20" x2="50" y2="80" stroke={ink} strokeWidth={stroke * 0.72} opacity="0.58" />
          <line x1="22" y1="36.5" x2="50" y2="50" stroke={ink} strokeWidth={stroke * 0.64} opacity="0.44" />
          <line x1="78" y1="36.5" x2="50" y2="50" stroke={ink} strokeWidth={stroke * 0.64} opacity="0.44" />
          <line x1="22" y1="63.5" x2="50" y2="50" stroke={dim} strokeWidth={stroke * 0.58} opacity="0.25" />
          <line x1="78" y1="63.5" x2="50" y2="50" stroke={dim} strokeWidth={stroke * 0.58} opacity="0.25" />
        </>
      )}
      <polygon points={INNER} stroke={ink} strokeWidth={stroke * 0.88} opacity="0.82" />
      {!compact && (
        <>
          <line x1="50" y1="39" x2="50" y2="61" stroke={ink} strokeWidth={stroke * 0.48} opacity="0.28" />
          <line x1="38.5" y1="45.8" x2="50" y2="50" stroke={ink} strokeWidth={stroke * 0.48} opacity="0.22" />
          <line x1="61.5" y1="45.8" x2="50" y2="50" stroke={ink} strokeWidth={stroke * 0.48} opacity="0.22" />
        </>
      )}
    </g>
  );
}

function AppIconPreview({ size = 128, compact = false }: { size?: number; compact?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className="block"
      role="img"
      aria-label={compact ? "Small Scout app icon treatment" : "Scout app icon treatment"}
    >
      <defs>
        <radialGradient id={`iconGlow-${size}-${compact ? "small" : "full"}`} cx="50%" cy="52%" r="70%">
          <stop offset="0%" stopColor="#242b23" />
          <stop offset="64%" stopColor="#151512" />
          <stop offset="100%" stopColor="#080907" />
        </radialGradient>
        <linearGradient id={`iconRim-${size}-${compact ? "small" : "full"}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.13" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.3" />
        </linearGradient>
      </defs>
      <rect x="5" y="5" width="90" height="90" rx="20" fill={`url(#iconGlow-${size}-${compact ? "small" : "full"})`} />
      <rect x="5" y="5" width="90" height="90" rx="20" fill="#fff4dc" opacity="0.035" />
      <g filter="drop-shadow(0 2px 8px rgba(0,0,0,0.28))">
        <CubeMark stroke={compact ? 5.2 : 4.35} compact={compact} />
      </g>
      <rect x="5" y="5" width="90" height="90" rx="20" fill="none" stroke={`url(#iconRim-${size}-${compact ? "small" : "full"})`} strokeWidth="0.7" />
    </svg>
  );
}

function MenuGlyph({ treatment, size = 20 }: { treatment: MenuTreatment; size?: number }) {
  const isLightPlate = treatment === "lightPlate";
  const isDarkPlate = treatment === "darkPlate";
  const plateFill = isLightPlate ? "#f6f2ea" : "#11110f";
  const ink = isLightPlate ? "#141414" : "#fff7ea";
  const dim = isLightPlate ? "rgba(20,20,20,0.58)" : "rgba(255,247,234,0.68)";
  const glyphInk = treatment === "templateGlyph" ? "currentColor" : ink;

  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className="block" aria-hidden="true">
      {treatment !== "templateGlyph" && (
        <>
          <rect x="1" y="1.4" width="18" height="17.2" rx="5.2" fill={plateFill} opacity={isLightPlate ? 0.94 : 0.96} />
          <rect x="1" y="1.4" width="18" height="17.2" rx="5.2" fill="none" stroke={isLightPlate ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.16)"} strokeWidth="0.7" />
        </>
      )}
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        <polygon points={MENU_OUTER} stroke={glyphInk} strokeWidth={treatment === "templateGlyph" ? 1.9 : 1.55} opacity={treatment === "templateGlyph" ? 0.92 : 1} />
        <polygon points={MENU_INNER} stroke={treatment === "templateGlyph" ? "currentColor" : dim} strokeWidth={treatment === "templateGlyph" ? 1.32 : 1.18} opacity={treatment === "templateGlyph" ? 0.68 : 1} />
      </g>
    </svg>
  );
}

function MenuBarSample({ tone }: { tone: "blue" | "dark" | "light" }) {
  const style =
    tone === "blue"
      ? "bg-[#2e98d6] text-white"
      : tone === "dark"
        ? "bg-[#111111] text-white"
        : "bg-[#f7f7f4] text-[#161616]";

  return (
    <div className={`overflow-hidden rounded-[6px] border border-studio-edge shadow-sm ${style}`}>
      <div className="flex h-[30px] items-center gap-4 px-4 font-sans text-[13px]">
        {MENU_TREATMENTS.map((item) => (
          <div key={`${tone}-${item.id}`} className="flex items-center gap-1.5">
            <MenuGlyph treatment={item.id} />
            <span className="font-medium">{item.label}</span>
          </div>
        ))}
        <div className="ml-auto font-mono text-[11px] opacity-70">Thu Jun 18 10:24 PM</div>
      </div>
    </div>
  );
}

export default function ScoutIconTreatmentsPage() {
  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <header className="mb-8 max-w-prose">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          studies / cross / identity
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Scout icon treatments
        </h1>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Small status marks and app icons are separated here because the menu bar needs a protected
          silhouette, while app/web/iOS can carry the fuller cube, rounded plate, and subtle lighting.
        </p>
      </header>

      <section className="grid gap-3">
        <div className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          menu bar simulations
        </div>
        <MenuBarSample tone="blue" />
        <MenuBarSample tone="dark" />
        <MenuBarSample tone="light" />
      </section>

      <section className="mt-10 grid gap-4 lg:grid-cols-[1fr_1fr_1fr]">
        {MENU_TREATMENTS.map((item) => (
          <article key={item.id} className="rounded-[8px] border border-studio-edge bg-studio-canvas-alt p-4">
            <div className="mb-4 flex items-center gap-4">
              <div className="grid h-12 w-12 place-items-center rounded-[8px] bg-[#2e98d6] text-white">
                <MenuGlyph treatment={item.id} size={24} />
              </div>
              <div>
                <h2 className="font-sans text-[13px] font-semibold text-studio-ink">{item.label}</h2>
                <div className="mt-1 font-mono text-[9px] uppercase tracking-eyebrow text-studio-ink-faint">
                  20 pt source / 24 px preview
                </div>
              </div>
            </div>
            <p className="font-sans text-[12px] leading-relaxed text-studio-ink-faint">{item.note}</p>
          </article>
        ))}
      </section>

      <section className="mt-12">
        <div className="mb-4 font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          app icon optical sizes
        </div>
        <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
          <article className="rounded-[8px] border border-studio-edge bg-studio-canvas-alt p-5">
            <div className="flex flex-wrap items-end gap-6">
              <AppIconPreview size={168} />
              <AppIconPreview size={96} />
              <AppIconPreview size={48} compact />
              <AppIconPreview size={24} compact />
            </div>
            <div className="mt-5 font-sans text-[12px] leading-relaxed text-studio-ink-faint">
              Production direction: heavier outer stroke, dimmer rear construction lines, warm off-white
              ink, neutral off-black field, rounded platform plate, and low grain so it feels lit without
              turning blue.
            </div>
          </article>
          <article className="rounded-[8px] border border-studio-edge bg-studio-canvas-alt p-5">
            <div className="mb-4 font-sans text-[13px] font-semibold text-studio-ink">
              Size rules
            </div>
            <div className="grid gap-3 font-sans text-[12px] leading-relaxed text-studio-ink-faint">
              <p>App/Web/iOS: full cube, thick outer boundary, softer rear lines, subtle field glow.</p>
              <p>Favicon and tiny app slots: same cube, but inner construction lines removed.</p>
              <p>Menu bar: protected plate plus outer and inner hex only. No crossing depth lines.</p>
            </div>
          </article>
        </div>
      </section>
    </main>
  );
}
