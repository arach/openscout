import { useTerminalRelay, TerminalRelay } from "@hudsonkit";
import {
  resolveScoutTerminalRelayHealthUrl,
  resolveScoutTerminalRelayUrl,
} from "../../lib/runtime-config.ts";

export function ScoutTerminal() {
  const relay = useTerminalRelay({
    url: resolveScoutTerminalRelayUrl(),
    healthUrl: resolveScoutTerminalRelayHealthUrl(),
    autoConnect: true,
    sessionKey: "scout-terminal",
  });

  return (
    <div style={{ height: "100%", background: "#0d0d0d", overflow: "hidden" }}>
      <TerminalRelay relay={relay} fontSize={13} />
    </div>
  );
}
