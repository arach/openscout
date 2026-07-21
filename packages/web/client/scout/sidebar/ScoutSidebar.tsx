/**
 * Scout primary navigation chrome (SCO-084 / SCO-085) — shadcn Sidebar composition.
 *
 * PURE NAVIGATION only (Requirement 7 revised 2026-07-20):
 * destinations, scope items, broker status, collapse trigger, machine scope,
 * ⌘K palette trigger. Per-area context content lives in the left HudsonKit
 * SidePanel (side rail), not here — do not re-introduce a Context group.
 *
 * SCO-085 full-height: brand strip at window top (titleBarInset padding),
 * drag region on the brand strip, no top bar. MachineScopeControl is the only
 * instance (footer). Settings is a primary area — no top-bar Settings button.
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
import { Command } from "lucide-react";
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
  SidebarTrigger,
  useSidebar,
} from "../../components/ui/sidebar.tsx";
import { MachineScopeControl } from "../../components/MachineScopeControl.tsx";
import { cn } from "../../lib/utils.ts";
import type { Route } from "../../lib/types.ts";
import { useScout } from "../Provider.tsx";
import {
  PRIMARY_AREAS,
  defaultRouteForArea,
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

function BrokerStatusLine() {
  const { apiConnection } = useScout();
  const offline = apiConnection.status === "offline";
  return (
    <div
      className={cn(
        "flex min-w-0 flex-1 items-center gap-1.5 font-mono text-[10px] font-semibold tracking-[0.04em] uppercase",
        "text-sidebar-foreground/60 group-data-[collapsible=icon]:hidden",
      )}
      title={offline ? "Scout API offline" : "Scout API connected"}
      data-sidebar="broker-status"
    >
      <span
        className={cn(
          "inline-block size-1.5 shrink-0 rounded-full",
          offline ? "bg-red-500" : "bg-emerald-400",
        )}
        aria-hidden
      />
      <span className="truncate">{offline ? "Offline" : "Broker"}</span>
    </div>
  );
}

function CommandPaletteButton({ onOpen }: { onOpen: () => void }) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          type="button"
          tooltip="Command palette (⌘K)"
          aria-label="Open command palette"
          title="Command palette (⌘K)"
          className="font-mono text-[11px] font-medium"
          onClick={onOpen}
          data-sidebar="command-palette"
        >
          <Command size={16} strokeWidth={1.6} aria-hidden />
          <span>Command</span>
          <span className="ml-auto font-mono text-[9px] tracking-wider text-sidebar-foreground/55 group-data-[collapsible=icon]:hidden">
            ⌘K
          </span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/**
 * Machine scope in the sidebar footer.
 * Expanded: full select. Collapsed 48px rail: icon that opens a compact popover
 * with the same select (never omit entirely — machine-scoped routes need a path).
 */
function SidebarMachineScope() {
  const { state } = useSidebar();
  return (
    <MachineScopeControl
      variant={state === "collapsed" ? "rail" : "sidebar"}
    />
  );
}

export function ScoutSidebar({
  brandLabel = "Scout",
  onOpenCommandPalette,
}: {
  /**
   * Fixed product brand (usually app.name / "Scout"). Scope's active section
   * label is NOT a brand — scope destinations live in the model body.
   */
  brandLabel?: string;
  /** Shell-owned command palette open callback (new ⌘K footer entry). */
  onOpenCommandPalette?: () => void;
}) {
  const { route, navigate } = useScout();
  const { titleBarInset, dragRegionProps, onInteractiveMouseDown } = usePlatform();
  const opsControlEnabled = useOptionalFlag("ops.control", true);
  const model = useSidebarModel(route);
  const activeAreaId = primaryAreaForRoute(route);
  const navigateAreas = PRIMARY_AREAS.filter((a) => a.section === "navigate");
  const systemAreas = PRIMARY_AREAS.filter((a) => a.section === "system");

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
      {/* Brand strip: drag region + titleBarInset so macOS traffic lights clear. */}
      <SidebarHeader
        className="border-b border-sidebar-border"
        style={{
          paddingTop: Math.max(8, titleBarInset || 0),
          ...((dragRegionProps as { style?: CSSProperties } | undefined)?.style ?? {}),
        }}
        {...(Object.fromEntries(
          Object.entries((dragRegionProps ?? {}) as Record<string, unknown>).filter(
            ([key]) => key !== "style",
          ),
        ) as HTMLAttributes<HTMLDivElement>)}
        data-sidebar-drag-region=""
      >
        <div className="flex items-center gap-0.5">
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
          {/* Collapse trigger in brand row (also in footer). */}
          <SidebarTrigger
            className="shrink-0"
            onMouseDown={onInteractiveMouseDown}
          />
        </div>
        {model.kind === "scope" ? (
          <div
            className="px-2 pb-1 font-mono text-[9px] tracking-[0.12em] uppercase text-sidebar-foreground/55 group-data-[collapsible=icon]:hidden"
            data-sidebar="scope-section"
          >
            Scope
          </div>
        ) : null}
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

      <SidebarFooter className="border-t border-sidebar-border gap-1.5">
        <SidebarMachineScope />
        {onOpenCommandPalette ? (
          <div onMouseDown={onInteractiveMouseDown}>
            <CommandPaletteButton onOpen={onOpenCommandPalette} />
          </div>
        ) : null}
        <div
          className="flex items-center gap-1 group-data-[collapsible=icon]:justify-center"
          onMouseDown={onInteractiveMouseDown}
        >
          <BrokerStatusLine />
          <SidebarTrigger className="ml-auto group-data-[collapsible=icon]:ml-0" />
        </div>
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
