import type { Route } from "../../lib/types.ts";
import { useScopePresentationAttrs } from "../../scope/index.ts";
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
  return <div className="scout-scope-route" {...scopeAttrs}>{body}</div>;
}
