import Link from "next/link";
import { LogoMark } from "@/components/logo-mark";
import { SiteThemeToggle } from "@/components/site-theme-toggle";

export type SiteHeaderActive = "docs" | "blog" | "privacy" | "manifest";

type SiteHeaderProps = {
  /** Highlight the current section in the right-hand nav. */
  active?: SiteHeaderActive;
  /** Optional muted context (e.g. current doc title). */
  context?: string;
  /**
   * Inner row max-width. Defaults to landing (`max-w-7xl`).
   * Pass a wider value only for full-bleed reading layouts (e.g. docs article).
   */
  maxWidthClassName?: string;
  /** Fixed overlay header (doc reading view + progress bar). */
  fixed?: boolean;
  /** 0–1 reading progress when `fixed` is used. */
  scrollProgress?: number;
  className?: string;
};

const GITHUB_REPO = "https://github.com/arach/openscout";

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  if (active) {
    return (
      <span className="operator-link text-[var(--site-ink)]" aria-current="page">
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className="operator-link">
      {children}
    </Link>
  );
}

/**
 * Shared chrome for secondary pages — same shell width and destinations as
 * the landing operator console (logo + GitHub / Docs / Blog).
 */
export function SiteHeader({
  active,
  context,
  maxWidthClassName = "max-w-7xl",
  fixed = false,
  scrollProgress,
  className = "",
}: SiteHeaderProps) {
  return (
    <header
      className={[
        "operator-console",
        fixed ? "fixed inset-x-0 top-0 z-40" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Match landing: mx-auto max-w-7xl px-6 operator-row */}
      <div
        className={["mx-auto flex items-center px-6 operator-row", maxWidthClassName]
          .filter(Boolean)
          .join(" ")}
      >
        <Link href="/" className="flex items-center gap-2.5">
          <LogoMark />
          <span className="font-[family-name:var(--font-spectral)] text-lg font-semibold tracking-tight text-[var(--site-ink)]">
            Scout
          </span>
        </Link>

        <div className="flex min-w-0 items-center gap-4">
          <a
            href={GITHUB_REPO}
            className="operator-link hidden sm:inline-flex"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
          <NavLink href="/docs" active={active === "docs"}>
            Docs
          </NavLink>
          <NavLink href="/blog" active={active === "blog"}>
            Blog
          </NavLink>
          {context ? (
            <span className="operator-link hidden max-w-[14rem] truncate text-[var(--site-muted)] lg:inline">
              {context}
            </span>
          ) : null}
          {active === "privacy" ? (
            <span className="operator-link text-[var(--site-ink)]" aria-current="page">
              Privacy
            </span>
          ) : null}
          {active === "manifest" ? (
            <span className="operator-link text-[var(--site-ink)]" aria-current="page">
              Manifest
            </span>
          ) : null}
          <SiteThemeToggle />
        </div>
      </div>

      {typeof scrollProgress === "number" ? (
        <div className="absolute inset-x-0 bottom-0 h-[2px]">
          <div
            className="h-full bg-[var(--site-progress)] transition-[width] duration-150"
            style={{ width: `${scrollProgress * 100}%` }}
          />
        </div>
      ) : null}
    </header>
  );
}
