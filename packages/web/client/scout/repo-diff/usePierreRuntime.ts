import { useCallback, useEffect, useState } from "react";
import {
  loadPierre,
  warmupHighlighter,
  type PierreRuntime,
} from "./pierre.ts";
import type { PierrePhase } from "./model.ts";
import type { ScoutRepoDiffSnapshot } from "./types.ts";

export type PierreRuntimeState = {
  pierre: PierreRuntime | null;
  pierrePhase: PierrePhase;
  pierreError: string | null;
  retryPierre: () => void;
};

export function usePierreRuntime(
  snapshot: ScoutRepoDiffSnapshot | null,
): PierreRuntimeState {
  const [pierre, setPierre] = useState<PierreRuntime | null>(null);
  const [pierrePhase, setPierrePhase] = useState<PierrePhase>("loading");
  const [pierreError, setPierreError] = useState<string | null>(null);

  const retryPierre = useCallback(() => {
    setPierrePhase("loading");
    setPierreError(null);
    loadPierre().then(
      (runtime) => {
        setPierre(runtime);
        setPierrePhase("ready");
      },
      (err) => {
        setPierreError(err instanceof Error ? err.message : String(err));
        setPierrePhase("error");
      },
    );
  }, []);

  useEffect(() => {
    let alive = true;
    loadPierre().then(
      (runtime) => {
        if (!alive) return;
        setPierre(runtime);
        setPierrePhase("ready");
      },
      (err) => {
        if (!alive) return;
        setPierreError(err instanceof Error ? err.message : String(err));
        setPierrePhase("error");
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (pierre && snapshot) {
      void warmupHighlighter(pierre, snapshot.render.preferredTheme);
    }
  }, [pierre, snapshot]);

  return { pierre, pierrePhase, pierreError, retryPierre };
}
