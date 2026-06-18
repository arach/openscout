import type { Route } from "../../lib/types.ts";
import type { useScout } from "../../scout/Provider.tsx";
import { SessionRefScreen } from "./SessionRefScreen.tsx";
import { SessionsScreen } from "./SessionsScreen.tsx";

type Navigate = ReturnType<typeof useScout>["navigate"];

export function SessionsContent({ route, navigate }: { route: Route; navigate: Navigate }) {
  if (route.view !== "sessions") return null;
  if (route.sessionId) {
    return (
      <SessionRefScreen
        sessionRef={route.sessionId}
        navigate={navigate}
      />
    );
  }
  return <SessionsScreen navigate={navigate} />;
}
