import { useTerminalRelay, TerminalRelay } from "@hudson/sdk";

function relayUrl(): string {
  if (typeof window === "undefined") return "ws://localhost:3200";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}`;
}

export function ScoutTerminal() {
  const relay = useTerminalRelay({
    url: relayUrl(),
    sessionKey: "scout-terminal",
  });

  return (
    <div style={{ height: "100%", background: "#0d0d0d", overflow: "hidden" }}>
      <TerminalRelay relay={relay} fontSize={13} />
    </div>
  );
}
