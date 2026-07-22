import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { NativeScoutSurfaceClient, installScoutSurfacePushReceiver } from "../../surface-contract/native-scout-surface-client.ts";
import type { SurfaceBootstrap } from "../../surface-contract/scout-surface-contract.ts";
import "./native-surface.css";

type NativeSurfaceBootstrap = Partial<SurfaceBootstrap>;

declare global {
  interface Window {
    __scoutSurfaceBootstrap?: NativeSurfaceBootstrap;
  }
}

function readBootstrap(): NativeSurfaceBootstrap | null {
  return window.__scoutSurfaceBootstrap ?? null;
}

export function NativeSurfaceApp({
  surface,
  title,
  children,
}: {
  surface: "lanes" | "dispatch";
  title: string;
  children?: ReactNode;
}) {
  const [bootstrap, setBootstrap] = useState<NativeSurfaceBootstrap | null>(readBootstrap);
  const [bridgeError, setBridgeError] = useState<string | null>(null);

  useEffect(() => {
    installScoutSurfacePushReceiver();
    const onBootstrap = () => setBootstrap(readBootstrap());
    window.addEventListener("scout:surface-bootstrap", onBootstrap);
    if (window.webkit?.messageHandlers?.scoutSurface) {
      const client = new NativeScoutSurfaceClient(surface, () => ({
        hostIds: (readBootstrap()?.selectedHostIds ?? []) as [string, ...string[]],
      }));
      void client.bootstrap()
        .then((value) => {
          window.__scoutSurfaceBootstrap = value;
          setBootstrap(value);
        })
        .catch((error) => setBridgeError(error instanceof Error ? error.message : String(error)));
    }
    return () => window.removeEventListener("scout:surface-bootstrap", onBootstrap);
  }, [surface]);

  const advertisedSurface = bootstrap?.surface;
  const incompatible = advertisedSurface && advertisedSurface !== surface;
  const connectedHosts = bootstrap?.hosts?.filter((host) => host.state === "connected") ?? [];

  return (
    <main className="native-surface" data-scout-surface={surface}>
      <header className="native-surface__header">
        <div>
          <span className="native-surface__eyebrow">Scout · Local surface</span>
          <h1>{title}</h1>
        </div>
        <span className="native-surface__revision">
          {bootstrap?.assetRevision ? bootstrap.assetRevision.slice(0, 8) : "bundled"}
        </span>
      </header>

      {bridgeError ? (
        <SurfaceState tone="error" title="Native bridge unavailable" detail={bridgeError} />
      ) : incompatible ? (
        <SurfaceState
          tone="error"
          title="Surface mismatch"
          detail={`Native selected ${advertisedSurface}; this bundle contains ${surface}.`}
        />
      ) : bootstrap ? (
        connectedHosts.length > 0 ? children ?? (
          <SurfaceState
            tone="ready"
            title={`${connectedHosts.length} host${connectedHosts.length === 1 ? "" : "s"} ready`}
            detail="The signed local page is running. The typed data adapter is the next migration gate."
          />
        ) : (
          <SurfaceState
            title="No connected hosts"
            detail="The page is available offline. Connect a paired Mac to populate this surface."
          />
        )
      ) : (
        <SurfaceState
          title="Waiting for Scout"
          detail="The signed local page loaded successfully and is waiting for native bootstrap data."
        />
      )}
    </main>
  );
}

function SurfaceState({
  title,
  detail,
  tone = "idle",
}: {
  title: string;
  detail: string;
  tone?: "idle" | "ready" | "error";
}) {
  return (
    <section className={`native-surface__state native-surface__state--${tone}`}>
      <span className="native-surface__signal" aria-hidden="true" />
      <div>
        <h2>{title}</h2>
        <p>{detail}</p>
      </div>
    </section>
  );
}
