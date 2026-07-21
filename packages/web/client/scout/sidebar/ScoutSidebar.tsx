/**
 * Scout primary navigation chrome (SCO-084 / SCO-085) — shadcn Sidebar composition.
 *
 * PURE NAVIGATION only (Requirement 7 revised 2026-07-20 / SCO-086):
 * destinations, scope items, broker status. Per-area context content lives in
 * the left HudsonKit SidePanel (side rail), not here — do not re-introduce a
 * Context group.
 *
 * SCO-085 full-height: brand strip at window top (titleBarInset padding),
 * drag region on the brand strip. Settings is a primary area.
 *
 * SCO-087: the app-wide top row (right of the sidebar) owns machine scope, the
 * ⌘K trigger and the settings accelerator — they are NOT in the sidebar footer
 * anymore (machine scope: exactly one instance, in the top row). The sidebar
 * edge chevron (RailToggle) is also rendered by the shell so it can ride the
 * ghost edge during drag-resize; the sidebar body is pure presentation.
 *
 * SCO-086: logo is static (click → Home, never a toggle).
 *
 * Gated by nav.sidebar; renders exactly one chrome tree vs legacy left panel.
 * State (open/collapsed) is owned by useSidebarCollapse via SidebarProvider;
 * this file is presentation only. Default presentation is the 48px icon rail.
 *
 * HudsonKit SidePanel is intentionally separate (side rail / right inspector /
 * legacy left). Do not route this chrome through SidePanel.
 */
import type { CSSProperties, HTMLAttributes } from "react";
import { usePlatform } from "@hudsonkit";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "../../components/ui/sidebar.tsx";
import { cn } from "../../lib/utils.ts";
import type { Route } from "../../lib/types.ts";
import { useScout } from "../Provider.tsx";
import {
  PRIMARY_AREAS,
  defaultRouteForArea,
  getPrimaryArea,
  primaryAreaForRoute,
  type PrimaryArea,
  type PrimaryAreaId,
} from "../primary-areas.ts";
import {
  areaSubNavForRoute,
  type AreaSubNavAreaId,
} from "../nav-destinations.ts";
import { useOptionalFlag } from "hudsonkit/flags";
import { useSidebarModel } from "./useSidebarModel.ts";

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

const ACTIVE_MENU_CLASS =
  "data-active:bg-sidebar-accent data-active:font-medium data-active:text-sidebar-accent-foreground data-active:shadow-[inset_2px_0_0_0_var(--sidebar-primary,var(--hud-accent,oklch(0.86_0.17_125)))]";

function AreaMenuItems({
  areas,
  activeAreaId,
  onNavigateArea,
  route,
  navigate,
}: {
  areas: readonly PrimaryArea[];
  activeAreaId: PrimaryAreaId;
  onNavigateArea: (id: PrimaryAreaId) => void;
  route: Route;
  navigate: (route: Route) => void;
}) {
  const { state } = useSidebar();
  const expanded = state === "expanded";
  const subNav = areaSubNavForRoute(route);

  return (
    <SidebarMenu>
      {areas.map((area) => {
        const Icon = area.icon;
        const active = area.id === activeAreaId;
        const areaSub =
          expanded &&
          active &&
          subNav &&
          (subNav.areaId as string) === area.id
            ? subNav.items
            : null;
        return (
          <SidebarMenuItem key={area.id}>
            <SidebarMenuButton
              type="button"
              isActive={active}
              tooltip={area.label}
              aria-current={active ? "page" : undefined}
              data-area={area.id}
              className={cn(
                "font-mono text-[11px] font-medium tracking-[0.02em]",
                ACTIVE_MENU_CLASS,
              )}
              onClick={() => onNavigateArea(area.id)}
            >
              <Icon size={16} strokeWidth={1.6} aria-hidden />
              <span>{area.label}</span>
            </SidebarMenuButton>
            {areaSub && areaSub.length > 0 ? (
              <SidebarMenuSub>
                {areaSub.map((item) => {
                  const itemActive = item.active(route);
                  return (
                    <SidebarMenuSubItem key={item.id}>
                      <SidebarMenuSubButton
                        render={<button type="button" />}
                        isActive={itemActive}
                        aria-current={itemActive ? "page" : undefined}
                        data-subnav={item.id}
                        className="font-mono text-[10px]"
                        onClick={() => navigate(item.route)}
                      >
                        <span>{item.label}</span>
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                  );
                })}
              </SidebarMenuSub>
            ) : null}
          </SidebarMenuItem>
        );
      })}
    </SidebarMenu>
  );
}

export function ScoutSidebar({
  brandLabel = "Scout",
}: {
  /**
   * Fixed product brand (usually app.name / "Scout"). Scope's active section
   * label is NOT a brand — scope destinations live in the model body.
   */
  brandLabel?: string;
}) {
  const { route, navigate, openSettings } = useScout();
  const { titleBarInset, dragRegionProps, onInteractiveMouseDown } = usePlatform();
  const opsControlEnabled = useOptionalFlag("ops.control", true);
  const model = useSidebarModel(route);
  const activeAreaId = primaryAreaForRoute(route);
  const navigateAreas = PRIMARY_AREAS.filter((a) => a.section === "navigate");
  // SCO-088c §2: Settings is pinned at the sidebar bottom (see footer), so it is
  // removed from the SYSTEM nav list — it must live exactly once. SYSTEM keeps Ops.
  const systemAreas = PRIMARY_AREAS.filter(
    (a) => a.section === "system" && a.id !== "settings",
  );
  const settingsArea = getPrimaryArea("settings");
  const SettingsIcon = settingsArea.icon;
  const settingsActive = activeAreaId === "settings";

  const goHome = () => navigate({ view: "inbox" });
  const goArea = (id: PrimaryAreaId) => {
    // Stay put if already in the area (preserve deep links).
    if (primaryAreaForRoute(route) === id) return;
    navigate(defaultRouteForArea(id, { opsControlEnabled }));
  };

  return (
    <Sidebar
      side="left"
      variant="sidebar"
      collapsible="icon"
      aria-label={model.kind === "scope" ? "Scope navigation" : "Primary navigation"}
      data-sidebar-kind={model.kind}
    >
      {/* Brand strip: drag region + titleBarInset so macOS traffic lights clear.
          SCO-087b: the brand band is pinned to the shared 44px top grid line
          (see app.css brand-row rule); titleBarInset is the only top padding so
          the SCOUT baseline lines up with the side-rail header + title bar. */}
      <SidebarHeader
        className="border-b border-sidebar-border"
        style={{
          paddingTop: titleBarInset || 0,
          ...((dragRegionProps as { style?: CSSProperties } | undefined)?.style ?? {}),
        }}
        {...(Object.fromEntries(
          Object.entries((dragRegionProps ?? {}) as Record<string, unknown>).filter(
            ([key]) => key !== "style",
          ),
        ) as HTMLAttributes<HTMLDivElement>)}
        data-sidebar-drag-region=""
      >
        {/* Static logo — click → Home, never a collapse toggle (SCO-086). */}
        <div className="flex items-center gap-0.5" data-sidebar="brand-row">
          <SidebarMenu className="min-w-0 flex-1">
            <SidebarMenuItem>
              <SidebarMenuButton
                type="button"
                size="lg"
                tooltip="Home"
                onClick={goHome}
                onMouseDown={onInteractiveMouseDown}
                aria-label="Scout Home"
                title="Home"
                className="font-mono data-[slot=sidebar-menu-button]:!p-2"
              >
                <ScoutMark className="size-[18px] shrink-0" />
                <span className="truncate text-[11px] font-bold tracking-[0.08em] uppercase">
                  {brandLabel}
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0">
        {model.kind === "scope" ? (
          <SidebarGroup>
            <SidebarGroupLabel className="font-mono text-[9px] tracking-[0.12em] uppercase">
              Surfaces
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {model.items.map((item) => (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      type="button"
                      isActive={item.active}
                      tooltip={item.label}
                      aria-current={item.active ? "page" : undefined}
                      data-area={item.id}
                      aria-label={item.label}
                      title={item.label}
                      className={cn(
                        "font-mono text-[11px] font-medium",
                        ACTIVE_MENU_CLASS,
                      )}
                      onClick={() => navigate(item.route)}
                    >
                      {/* Scope items have no icons — initial-letter fallback for icon rail. */}
                      <span
                        className="flex size-4 shrink-0 items-center justify-center text-[11px] font-bold uppercase"
                        aria-hidden
                      >
                        {item.label.slice(0, 1)}
                      </span>
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : (
          <>
            <SidebarGroup>
              <SidebarGroupLabel className="font-mono text-[9px] tracking-[0.12em] uppercase">
                Navigate
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <AreaMenuItems
                  areas={navigateAreas}
                  activeAreaId={activeAreaId}
                  onNavigateArea={goArea}
                  route={route}
                  navigate={navigate}
                />
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarGroup>
              <SidebarGroupLabel className="font-mono text-[9px] tracking-[0.12em] uppercase">
                System
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <AreaMenuItems
                  areas={systemAreas}
                  activeAreaId={activeAreaId}
                  onNavigateArea={goArea}
                  route={route}
                  navigate={navigate}
                />
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        {/* SCO-088c §2: Settings is pinned at the sidebar bottom (where the Broker
            block used to sit — broker status lives only in the 28px status bar now).
            Same destination as the retired top-right gear (/settings); nav-item
            styling, left-accent when the settings route is active. Collapsed → a
            centered gear (label hidden, hover tooltip kept). */}
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              isActive={settingsActive}
              tooltip={settingsArea.label}
              aria-current={settingsActive ? "page" : undefined}
              data-area="settings"
              className={cn(
                "font-mono text-[11px] font-medium tracking-[0.02em]",
                ACTIVE_MENU_CLASS,
              )}
              onClick={() => openSettings()}
            >
              <SettingsIcon size={16} strokeWidth={1.6} aria-hidden />
              <span>{settingsArea.label}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}

/** Hook-friendly active area for tests / consumers. */
export function sidebarActiveAreaId(route: Route): PrimaryAreaId {
  return primaryAreaForRoute(route);
}

/** Area sub-nav area ids used by the sidebar projection (tests). */
export type { AreaSubNavAreaId };
