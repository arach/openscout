import Link from "next/link";
import { STUDIO_PAGES } from "@/lib/studio-pages";

export default function AtomsIndex() {
  const atoms = STUDIO_PAGES.filter(
    (p) => p.bucket === "atoms" && p.href !== "/atoms",
  );

  return (
    <main className="mx-auto max-w-page px-7 py-9 sm:px-9">
      <div className="mb-10 pb-2">
        <div className="flex items-center gap-2 text-2xs font-semibold uppercase tracking-eyebrow text-studio-ink-faint">
          <span className="text-scout-accent" aria-hidden>
            ·
          </span>
          atoms
        </div>
        <h1 className="mt-2 font-display text-6xl font-medium leading-none tracking-tight text-studio-ink">
          Atoms Index
        </h1>
        <p className="mt-3.5 max-w-prose font-sans text-lg leading-relaxed text-studio-ink-faint">
          Live-rendered web primitives. Each atom is its own route — drop
          a folder in <code className="font-mono text-sm text-studio-ink">app/atoms/</code> and
          register it in <code className="font-mono text-sm text-studio-ink">lib/studio-pages.ts</code>.
        </p>
        <div className="studio-rule mt-6 max-w-prose" />
      </div>

      {atoms.length === 0 ? (
        <p className="font-sans text-lg italic text-studio-ink-faint">
          No atoms registered yet.
        </p>
      ) : (
        <ul className="grid gap-2.5">
          {atoms.map((a) => (
            <li key={a.href}>
              <Link
                href={a.href}
                className="studio-card focus-ring group block px-5 py-4"
              >
                <div className="relative flex items-baseline gap-3">
                  <div className="text-2xs font-semibold text-scout-accent" aria-hidden>
                    ·
                  </div>
                  <div className="font-display text-3xl font-medium tracking-tight text-studio-ink">
                    {a.label}
                  </div>
                  {a.status ? (
                    <div className="font-mono text-2xs uppercase tracking-eyebrow text-studio-ink-faint">
                      {a.status}
                    </div>
                  ) : null}
                </div>
                {a.blurb ? (
                  <p className="relative ml-5 mt-1.5 font-sans text-lg leading-relaxed text-studio-ink-faint">
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
