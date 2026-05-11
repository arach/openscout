import { useTerminalRelay, TerminalRelay } from "@hudson/sdk";

const TERMINAL_RELAY_PATH = "/ws/terminal";

function relayUrl(): string {
  if (typeof window === "undefined") return `ws://localhost:3200${TERMINAL_RELAY_PATH}`;
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}${TERMINAL_RELAY_PATH}`;
}

export function ScoutTerminal() {
  const relay = useTerminalRelay({
    url: relayUrl(),
    autoConnect: true,
    sessionKey: "scout-terminal",
  });

  return (
    <div style={{ height: "100%", background: "#0d0d0d", overflow: "hidden" }}>
      <TerminalRelay relay={relay} fontSize={13} />
    </div>
  );
}
