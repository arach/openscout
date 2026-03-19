import type { ScoutModuleDescriptor } from "@openscout/protocol";

export interface ScoutRuntimeRegistry {
  modules: ScoutModuleDescriptor[];
}

export function createRuntimeRegistry(
  modules: ScoutModuleDescriptor[] = [],
): ScoutRuntimeRegistry {
  return { modules };
}
