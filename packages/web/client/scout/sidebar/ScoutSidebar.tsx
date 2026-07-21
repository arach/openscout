/**
 * Classic sidebar chrome (SCO-083) — expanded (~260px) + icon rail (~48px).
 * Gated by nav.sidebar; renders exactly one chrome tree vs legacy left panel.
 */
import type React from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useOptionalFlag } from "hudsonkit/flags";
import { Tooltip } from "@base-ui-components/react/tooltip";
import type { Route } from "../../lib/types.ts";
import { useScout } from "../Provider.tsx";
import {
  PRIMARY_AREAS,
  defaultRouteForArea,
  primaryAreaForRoute,
  type PrimaryArea,
  type PrimaryAreaId,
} from "../primary-areas.ts";
import { resolveSidebarContext } from "../../screens/resolve-sidebar-context.tsx";
import { useSidebarModel } from "./useSidebarModel.ts";
import "./scout-sidebar.css";

function ScoutMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polygon
        points="10,4.3 14.8,7.1 14.8,12.9 10,15.7 5.2,12.9 5.2,7.1"
        strokeWidth="1.9"
        fill="currentColor"
        fillOpacity="0.12"
      />
      <polygon
        points="10,7 12.4,8.4 12.4,10.6 10,12 7.6,10.6 7.6,8.4"
        strokeWidth="0.9"
        fill="currentColor"
        fillOpacity="0.9"
      />
    </svg>
  );
}

function AreaButton({
  area,
  active,
  collapsed,
  onSelect,
}: {
  area: PrimaryArea;
  active: boolean;
  collapsed: boolean;
  onSelect: () => void;
}) {
  const Icon = area.icon;
  const className = `scout-sidebar-item${active ? " scout-sidebar-item--active" : ""}`;

  if (!collapsed) {
    return (
      <button
        type="button"
        className={className}
        onClick={onSelect}
        aria-current={active ? "page" : undefined}
        data-area={area.id}
      >
        <Icon size={16} strokeWidth={1.6} aria-hidden className="scout-sidebar-item-icon" />
        <span className="scout-sidebar-item-label">{area.label}</span>
      </button>
    );
  }

  return (
    <Tooltip.Root>
      <Tooltip.Trigger
        type="button"
        className={className}
        onClick={onSelect}
        aria-current={active ? "page" : undefined}
        data-area={area.id}
        aria-label={area.label}
        delay={200}
      >
        <Icon size={16} strokeWidth={1.6} aria-hidden className="scout-sidebar-item-icon" />
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Positioner side="right" sideOffset={8}>
          <Tooltip.Popup className="scout-sidebar-tooltip">{area.label}</Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function AreaSection({
  title,
  areas,
  activeAreaId,
  collapsed,
  onNavigateArea,
}: {
  title: string;
  areas: readonly PrimaryArea[];
  activeAreaId: PrimaryAreaId;
  collapsed: boolean;
  onNavigateArea: (id: PrimaryAreaId) => void;
}) {
  return (
    <div className="scout-sidebar-section" role="group" aria-label={title}>
      {!collapsed && <div className="scout-sidebar-section-label">{title}</div>}
      <div className="scout-sidebar-section-items">
        {areas.map((area) => (
          <AreaButton
            key={area.id}
            area={area}
            active={area.id === activeAreaId}
            collapsed={collapsed}
            onSelect={() => onNavigateArea(area.id)}
          />
        ))}
      </div>
    </div>
  );
}

export function ScoutSidebar({
  collapsed,
  width,
  onToggleCollapse,
  brandLabel = "Scout",
}: {
  collapsed: boolean;
  width: number;
  onToggleCollapse: () => void;
  brandLabel?: string;
}) {
  const { route, navigate } = useScout();
  const opsControlEnabled = useOptionalFlag("ops.control", true);
  const model = useSidebarModel(route);
  const activeAreaId = primaryAreaForRoute(route);
  // Scope presentation uses its own destination list; no Scout context pane.
  const context =
    model.kind === "scope"
      ? { body: null as React.ReactNode, footer: null as React.ReactNode }
      : resolveSidebarContext(route, navigate);
  const navigateAreas = PRIMARY_AREAS.filter((a) => a.section === "navigate");
  const systemAreas = PRIMARY_AREAS.filter((a) => a.section === "system");

  const goHome = () => navigate({ view: "inbox" });
  const goArea = (id: PrimaryAreaId) => {
    // Stay put if already in the area (preserve deep links).
    if (primaryAreaForRoute(route) === id) return;
    navigate(defaultRouteForArea(id, { opsControlEnabled }));
  };

  return (
    <Tooltip.Provider delay={200}>
      <aside
        className={`scout-sidebar${collapsed ? " scout-sidebar--collapsed" : ""}${
          model.kind === "scope" ? " scout-sidebar--scope" : ""
        }`}
        style={{ width }}
        data-sidebar="primary"
        data-sidebar-kind={model.kind}
        aria-label={model.kind === "scope" ? "Scope navigation" : "Primary navigation"}
      >
        <header className="scout-sidebar-header">
          <button
            type="button"
            className="scout-sidebar-brand"
            onClick={goHome}
            title="Home"
            aria-label="Scout Home"
          >
            <ScoutMark className="scout-sidebar-brand-mark" />
            {!collapsed && <span className="scout-sidebar-brand-label">{brandLabel}</span>}
          </button>
        </header>

        <nav className="scout-sidebar-nav" aria-label={model.kind === "scope" ? "Scope areas" : "Primary areas"}>
          {model.kind === "scope" ? (
            <div className="scout-sidebar-section" role="group" aria-label="Scope">
              {!collapsed && <div className="scout-sidebar-section-label">Scope</div>}
              <div className="scout-sidebar-section-items">
                {model.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`scout-sidebar-item${item.active ? " scout-sidebar-item--active" : ""}`}
                    onClick={() => navigate(item.route)}
                    aria-current={item.active ? "page" : undefined}
                    data-area={item.id}
                    title={item.label}
                    aria-label={item.label}
                  >
                    {!collapsed && <span className="scout-sidebar-item-label">{item.label}</span>}
                    {collapsed && (
                      <span className="scout-sidebar-item-label scout-sidebar-item-label--initial">
                        {item.label.slice(0, 1)}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              <AreaSection
                title="Navigate"
                areas={navigateAreas}
                activeAreaId={activeAreaId}
                collapsed={collapsed}
                onNavigateArea={goArea}
              />
              <AreaSection
                title="System"
                areas={systemAreas}
                activeAreaId={activeAreaId}
                collapsed={collapsed}
                onNavigateArea={goArea}
              />
            </>
          )}
        </nav>

        {!collapsed && (context.body || context.footer) && (
          <div className="scout-sidebar-context" data-sidebar="context">
            {context.body ? (
              <div className="scout-sidebar-context-body">{context.body}</div>
            ) : null}
            {context.footer ? (
              <div className="scout-sidebar-context-footer">{context.footer}</div>
            ) : null}
          </div>
        )}

        <footer className="scout-sidebar-footer">
          <button
            type="button"
            className="scout-sidebar-collapse-btn"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar (⌘B)" : "Collapse sidebar (⌘B)"}
          >
            {collapsed ? (
              <PanelLeftOpen size={16} strokeWidth={1.6} aria-hidden />
            ) : (
              <>
                <PanelLeftClose size={16} strokeWidth={1.6} aria-hidden />
                <span>Collapse</span>
              </>
            )}
          </button>
        </footer>
      </aside>
    </Tooltip.Provider>
  );
}

/** Hook-friendly active area for tests / consumers. */
export function sidebarActiveAreaId(route: Route): PrimaryAreaId {
  return primaryAreaForRoute(route);
}
