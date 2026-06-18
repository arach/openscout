import type { Route } from "../../lib/types.ts";
import type { useScout } from "../../scout/Provider.tsx";
import { KnowledgeSearchScreen } from "./KnowledgeSearchScreen.tsx";

type Navigate = ReturnType<typeof useScout>["navigate"];

export function SearchContent({ route, navigate }: { route: Route; navigate: Navigate }) {
  if (route.view !== "search") return null;
  return <KnowledgeSearchScreen navigate={navigate} mode={route.mode} />;
}
