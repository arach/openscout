import { useScout } from "../../scout/Provider.tsx";
import { BrokerAttemptInspector, BrokerScreen } from "./BrokerScreen.tsx";

/**
 * Chrome-free dispatch (broker) ledger for the macOS WKWebView embed
 * (the Scout app's "Dispatch" section). Mirrors AgentLanesEmbedScreen:
 * renders the shared screen in `embedded` mode (no OpsSubnav) and supplies
 * its own inspector drawer, since the standalone embed has no shell
 * inspector slot to receive `selectedBrokerAttempt`.
 */
export function BrokerEmbedScreen() {
  const { navigate, selectedBrokerAttempt, clearBrokerAttempt } = useScout();

  return (
    <div className="s-broker-embed" data-scout-theme>
      <BrokerScreen navigate={navigate} embedded />
      {selectedBrokerAttempt && (
        <>
          <button
            type="button"
            className="s-broker-embed-scrim"
            aria-label="Close inspector"
            onClick={clearBrokerAttempt}
          />
          <div className="s-broker-embed-inspector">
            <BrokerAttemptInspector
              attempt={selectedBrokerAttempt}
              navigate={navigate}
              onClose={clearBrokerAttempt}
            />
          </div>
        </>
      )}
    </div>
  );
}
