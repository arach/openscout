import Link from "next/link";
import { STUDIO_PAGES } from "@/lib/studio-pages";

export default function AtomsIndex() {
  const atoms = STUDIO_PAGES.filter(
    (p) => p.bucket === "atoms" && p.href !== "/atoms",
  );

  return (
    <main className="mx-auto max-w-page px-7 py-8">
      <div className="mb-8 border-b border-studio-edge pb-5">
        <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          · atoms
        </div>
        <h1 className="mt-1 font-display text-[28px] font-medium leading-none tracking-tight text-studio-ink">
          Atoms Index
        </h1>
        <p className="mt-3 max-w-prose font-sans text-[13px] leading-relaxed text-studio-ink-faint">
          Live-rendered web primitives. Each atom is its own route — drop
          a folder in <code className="font-mono text-[11px] text-studio-ink">app/atoms/</code> and
          register it in <code className="font-mono text-[11px] text-studio-ink">lib/studio-pages.ts</code>.
        </p>
      </div>

      {atoms.length === 0 ? (
        <p className="font-sans text-[13px] italic text-studio-ink-faint">
          No atoms registered yet.
        </p>
      ) : (
        <ul className="grid gap-3">
          {atoms.map((a) => (
            <li key={a.href}>
              <Link
                href={a.href}
                className="group block rounded-md border border-studio-edge px-5 py-4 transition-colors hover:border-studio-ink"
              >
                <div className="flex items-baseline gap-3">
                  <div className="text-[9px] font-semibold uppercase tracking-eyebrow text-studio-ink-faint transition-colors group-hover:text-studio-ink">
                    ·
                  </div>
                  <div className="font-display text-[19px] font-medium tracking-tight text-studio-ink">
                    {a.label}
                  </div>
                  {a.status ? (
                    <div className="font-mono text-[9px] uppercase tracking-[0.20em] text-studio-ink-faint">
                      {a.status}
                    </div>
                  ) : null}
                </div>
                {a.blurb ? (
                  <p className="ml-5 mt-1.5 font-sans text-[13px] leading-relaxed text-studio-ink-faint">
                    {a.blurb}
                  </p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
