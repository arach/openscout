import { SecondaryNavShell } from "../../scout/layout/SecondaryNavShell.tsx";
import { useScout } from "../../scout/Provider.tsx";
import { AgentsSubnav } from "../agents/AgentsSubnav.tsx";
import type { Route } from "../../lib/types.ts";
import { RawSessionsTable } from "./RawSessionsTable.tsx";

export function SessionsScreen({
  navigate,
}: {
  navigate: (r: Route) => void;
}) {
  const { route } = useScout();

  return (
    <SecondaryNavShell subnav={<AgentsSubnav activeRoute={route} navigate={navigate} />}>
      <RawSessionsTable navigate={navigate} />
    </SecondaryNavShell>
  );
}