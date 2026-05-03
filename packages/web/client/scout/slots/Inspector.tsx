import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useScout } from "../Provider.tsx";
import { AgentsInspector } from "../inspector/AgentsInspector.tsx";
import { HomeAgentsInspector } from "../inspector/HomeAgentsInspector.tsx";
import { SessionsInspector } from "../inspector/SessionsInspector.tsx";
import { WorkInspector } from "../inspector/WorkInspector.tsx";
import { MeshInspectorPanel } from "../inspector/MeshInspector.tsx";
import { RangerPanel } from "../ranger/RangerPanel.tsx";
import { BrokerAttemptInspector } from "../../screens/BrokerScreen.tsx";
import { usePersistentBoolean, usePersistentNumber } from "../../lib/persistent-state.ts";
import { VerticalResizeHandle } from "./VerticalResizeHandle.tsx";

const RANGER_MIN_HEIGHT = 180;
const RANGER_MAX_HEIGHT_RATIO = 0.7;
const RANGER_DEFAULT_HEIGHT = 320;

function clampRangerHeight(value: number, inspectorHeight: number) {
  const max = Math.max(RANGER_MIN_HEIGHT, Math.floor(inspectorHeight * RANGER_MAX_HEIGHT_RATIO));
  return Math.min(max, Math.max(RANGER_MIN_HEIGHT, Math.round(value)));
}

export function ScoutInspector() {
  const { route, navigate, selectedBrokerAttempt, clearBrokerAttempt } = useScout();
  const [rangerCollapsed] = usePersistentBoolean("openscout.ranger.collapsed", false);
  const [rangerHeight, setRangerHeight] = usePersistentNumber("openscout.ranger.height", RANGER_DEFAULT_HEIGHT);
  const containerRef = useRef<HTMLDivElement>(null);
  const [inspectorHeight, setInspectorHeight] = useState(0);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setInspectorHeight(el.getBoundingClientRect().height);
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setInspectorHeight(entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (inspectorHeight <= 0) return;
    const next = clampRangerHeight(rangerHeight, inspectorHeight);
    if (next !== rangerHeight) {
      setRangerHeight(next);
    }
  }, [inspectorHeight, rangerHeight, setRangerHeight]);

  const handleResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const startY = event.clientY;
      const startHeight = rangerHeight;
      const containerHeight = containerRef.current?.getBoundingClientRect().height ?? inspectorHeight;

      const onMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientY - startY;
        setRangerHeight(clampRangerHeight(startHeight - delta, containerHeight));
      };
      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.removeProperty("cursor");
        document.body.style.removeProperty("user-select");
      };

      document.body.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [inspectorHeight, rangerHeight, setRangerHeight],
  );

  let content: ReactNode = null;

  switch (route.view) {
    case "inbox":
    case "fleet":
      content = <HomeAgentsInspector />;
      break;
    case "agents":
    case "agent-info":
      content = <AgentsInspector />;
      break;
    case "sessions":
    case "conversation":
      content = <SessionsInspector />;
      break;
    case "work":
      content = <WorkInspector />;
      break;
    case "mesh":
      content = <MeshInspectorPanel />;
      break;
    case "ops":
      content = null;
      break;
    case "broker":
      content = selectedBrokerAttempt
        ? (
          <BrokerAttemptInspector
            attempt={selectedBrokerAttempt}
            navigate={navigate}
            onClose={clearBrokerAttempt}
          />
        )
        : <BrokerInspectorEmpty />;
      break;
    default:
      content = null;
  }

  const clampedRangerHeight = inspectorHeight > 0
    ? clampRangerHeight(rangerHeight, inspectorHeight)
    : rangerHeight;

  return (
    <div ref={containerRef} className="flex h-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-hidden">
        {content}
      </div>
      {!rangerCollapsed && <VerticalResizeHandle onResizeStart={handleResizeStart} />}
      <RangerPanel height={rangerCollapsed ? undefined : clampedRangerHeight} />
    </div>
  );
}

function BrokerInspectorEmpty() {
  return (
    <div className="sys-broker-right-empty">
      <div className="sys-kicker">Broker</div>
      <p>Select any broker ledger row to inspect route metadata here.</p>
    </div>
  );
}
