/**
 * The design system registry.
 *
 * One array. Adding a component is an import and a line — deliberately manual,
 * because entering the registry is the act of claiming a component is adoptable,
 * and that should be a decision somebody makes rather than a glob that sweeps
 * up every sketch in the folder.
 *
 * Everything that consumes the design system reads from here: the `/system`
 * route, the JSON endpoint at `/api/design-system`, and the `ds` CLI.
 */

import { runtimePickerManifest } from "@/components/RuntimePicker.manifest";
import {
  auditManifest,
  meetsStatus,
  searchManifests,
  type ComponentManifest,
  type ComponentStatus,
  type SearchHit,
} from "./manifest";

export const REGISTRY: ComponentManifest[] = [runtimePickerManifest];

export function allComponents(): ComponentManifest[] {
  return [...REGISTRY].sort((a, b) => a.name.localeCompare(b.name));
}

export function getComponent(id: string): ComponentManifest | undefined {
  return REGISTRY.find((manifest) => manifest.id === id);
}

export function componentsByStatus(status: ComponentStatus): ComponentManifest[] {
  return allComponents().filter((manifest) => manifest.status === status);
}

export function findComponents(query: string, limit = 10): SearchHit[] {
  return searchManifests(REGISTRY, query).slice(0, limit);
}

export interface RegistryHealth {
  id: string;
  status: ComponentStatus;
  /** False when the manifest claims `graduated` but fails the audit. */
  honest: boolean;
  errors: number;
  warnings: number;
}

/**
 * A status a component cannot back up is worse than no status at all, so the
 * registry can be asked whether it is telling the truth. `/system` renders
 * this, and the CLI exits non-zero on it.
 */
export function registryHealth(): RegistryHealth[] {
  return allComponents().map((manifest) => {
    const issues = auditManifest(manifest);
    return {
      id: manifest.id,
      status: manifest.status,
      honest: meetsStatus(manifest),
      errors: issues.filter((issue) => issue.level === "error").length,
      warnings: issues.filter((issue) => issue.level === "warning").length,
    };
  });
}

export { auditManifest, meetsStatus, searchManifests };
export type { ComponentManifest, ComponentStatus, SearchHit };
