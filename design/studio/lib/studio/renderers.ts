/**
 * Output renderer registry for Studio commands.
 *
 * A renderer turns a typed command output into JSX. Renderers are looked up by
 * `RendererKind` so a `<CommandSurface>` only needs to know which kind its
 * output is, not how to draw it.
 *
 * Registry instance is module-singleton — register at module load. JSX is kept
 * out of this file so consumers can register their own renderers without
 * pulling React into pure exec code paths.
 */

import type { ReactNode } from "react";

export type RendererKind =
  | "rows"      // table of homogeneous records
  | "stream"    // ordered event/record list
  | "files"     // file list + selected-file preview
  | "kv"        // key-value pairs
  | "ranked"    // ranked list with scores
  | "raw";      // single code/text block

export interface RendererProps<T = unknown> {
  output: T;
  /** Optional sub-selection: row id, file name, record index, etc. */
  focus?: string;
}

export interface OutputRenderer<T = unknown> {
  kind: RendererKind;
  render: (props: RendererProps<T>) => ReactNode;
}

const registry = new Map<RendererKind, OutputRenderer<unknown>>();

export function registerRenderer<T>(r: OutputRenderer<T>): void {
  registry.set(r.kind, r as OutputRenderer<unknown>);
}

export function lookupRenderer(kind: RendererKind): OutputRenderer | undefined {
  return registry.get(kind);
}
