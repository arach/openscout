import type { ReactNode } from "react";
import "./page-header.css";

export interface PageHeaderProps {
  /** The page title. Rendered as the heading element chosen via `as`. */
  title: ReactNode;
  /** Small uppercase context label above the title (area, project, branch). */
  eyebrow?: ReactNode;
  /** One-line description under the title. */
  subtitle?: ReactNode;
  /** Inline metadata row under the title group (updated time, owner, counts, ids). */
  meta?: ReactNode;
  /** Status signal — a StatusPill, dot, or live indicator. Leads the actions cluster. */
  status?: ReactNode;
  /** Muted sync / timestamp note, shown before the action buttons. */
  syncNote?: ReactNode;
  /** Primary and secondary action controls (buttons, toggles). */
  actions?: ReactNode;
  /** Leading slot before the title group (back button, avatar). */
  lead?: ReactNode;
  /** Heading level for the title. Defaults to `h2`. */
  as?: "h1" | "h2";
  /** Extra className on the root element. */
  className?: string;
  /** Optional id applied to the title, for `aria-labelledby` wiring. */
  titleId?: string;
}

/**
 * App Page Header — the reusable top-of-page band shared across web screens.
 *
 * Replaces per-screen header blocks (`.sys-page-head`, bespoke `*-hero` /
 * `*-toolbar` bands) with one calm, dense, operational treatment. Every region
 * is optional except `title`; pass only what a screen needs.
 */
export function PageHeader({
  title,
  eyebrow,
  subtitle,
  meta,
  status,
  syncNote,
  actions,
  lead,
  as = "h2",
  className = "",
  titleId,
}: PageHeaderProps) {
  const Heading = as;
  const hasActions = status != null || syncNote != null || actions != null;

  return (
    <header className={`s-page-header${className ? ` ${className}` : ""}`}>
      <div className="s-page-header-bar">
        {lead != null && <div className="s-page-header-lead">{lead}</div>}
        <div className="s-page-header-titles">
          {eyebrow != null && <span className="s-page-header-eyebrow">{eyebrow}</span>}
          <Heading id={titleId} className="s-page-header-title">{title}</Heading>
          {subtitle != null && <p className="s-page-header-subtitle">{subtitle}</p>}
          {meta != null && <div className="s-page-header-meta">{meta}</div>}
        </div>
        {hasActions && (
          <div className="s-page-header-actions">
            {status}
            {syncNote != null && <div className="s-page-header-sync">{syncNote}</div>}
            {actions}
          </div>
        )}
      </div>
    </header>
  );
}
