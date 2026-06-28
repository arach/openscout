import "../../scope/views/scope-views.css";

import type { Route } from "../../lib/types.ts";
import { useLocation } from "@tanstack/react-router";
import {
  routeBelongsInScopeNamespace,
  scopeViewSegment,
  useScopePresentationAttrs,
} from "../../scope/index.ts";
import type { useScout } from "../../scout/Provider.tsx";
import { SessionRefScreen } from "./SessionRefScreen.tsx";
import { SessionsScreen } from "./SessionsScreen.tsx";

type Navigate = ReturnType<typeof useScout>["navigate"];

export function SessionsContent({ route, navigate }: { route: Route; navigate: Navigate }) {
  const scopeAttrs = useScopePresentationAttrs();
  if (route.view !== "sessions") return null;
  const body = route.sessionId
    ? (
      <SessionRefScreen
        sessionRef={route.sessionId}
        navigate={navigate}
      />
    )
    : <SessionsScreen navigate={navigate} />;
  const { pathname } = useLocation();
  const scopeOwned = routeBelongsInScopeNamespace(route, pathname);
  const scopeView = scopeViewSegment(route, pathname);
  return (
    <div
      className={scopeOwned ? "scope-sessions-route" : undefined}
      data-scope-view={scopeView ?? undefined}
      {...scopeAttrs}
    >
      {body}
    </div>
  );
}
