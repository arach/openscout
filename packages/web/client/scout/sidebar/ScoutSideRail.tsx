/**
 * Scout side rail (SCO-084) — LEFT HudsonKit SidePanel for per-area context.
 *
 * Distinct shell slot from the shadcn nav sidebar and from the legacy LeftPanel
 * path. Shares the SidePanel component with the right inspector; does not wrap
 * or restyle SidePanel into a sidebar.
 *
 * Content: resolveSidebarContext(route) body (scrollable) + footer pinned at
 * the panel bottom (Mesh rack/map behavior unchanged).
 */
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { SidePanel } from "@hudsonkit/chrome";
import type { Route } from "../../lib/types.ts";
import { useScout } from "../Provider.tsx";
import { primaryAreaForRoute, PRIMARY_AREAS } from "../primary-areas.ts";
import { resolveSidebarContext } from "../../screens/resolve-sidebar-context.tsx";
import { useSidebarModel } from "./useSidebarModel.ts";

/**
 * Whether resolveSidebarContext yields body/footer for the current route.
 * Used by the shell for left-inset arithmetic without mounting the rail.
 * Scope presentation has no Scout context pane.
 */
export function sideRailHasContent(route: Route, scopePresentation: boolean): boolean {
  if (scopePresentation) return false;
  // Keep in sync with resolveSidebarContext non-null cases.
  switch (route.view) {
    case "inbox":
    case "activity":
    case "briefings":
    case "agents-v2":
    case "agent-info":
    case "terminal":
    case "messages":
    case "channels":
    case "conversation":
    case "ops":
    case "mesh":
      return true;
    default:
      return false;
  }
}

export function ScoutSideRail({
  navRailWidth,
  isCollapsed,
  onToggleCollapse,
  width,
  onResizeStart,
  style,
  hideWhenEmpty = true,
}: {
  /** Current shadcn sidebar width (48 or 260) — side rail sits to its right. */
  navRailWidth: number;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
  onResizeStart?: (event: MouseEvent) => void;
  style?: CSSProperties;
  /** When true, render nothing if both body and footer are null. */
  hideWhenEmpty?: boolean;
}) {
  const { route, navigate } = useScout();
  const model = useSidebarModel(route);
  const context =
    model.kind === "scope"
      ? { body: null as ReactNode, footer: null as ReactNode }
      : resolveSidebarContext(route, navigate);

  const empty = !context.body && !context.footer;
  if (hideWhenEmpty && empty) return null;

  const areaId = primaryAreaForRoute(route);
  const area = PRIMARY_AREAS.find((a) => a.id === areaId);
  const title = model.kind === "scope" ? "Scope" : (area?.label ?? "Context");

  return (
    <SidePanel
      side="left"
      title={title}
      isCollapsed={isCollapsed}
      onToggleCollapse={onToggleCollapse}
      width={width}
      onResizeStart={onResizeStart}
      style={{
        // Sit beside the nav icon/expanded rail (SidePanel defaults to left: 0).
        left: navRailWidth,
        ...style,
      }}
      footer={!isCollapsed && context.footer ? context.footer : undefined}
    >
      <div data-pane="side-rail" data-scout-side-rail="" style={{ display: "contents" }}>
        {context.body}
      </div>
    </SidePanel>
  );
}
