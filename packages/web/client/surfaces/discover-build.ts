import type { ComponentType } from "react";
import {
  defaultEmbedPath,
  type EmbedScreenProps,
  type RegisteredSurface,
  type ScoutSurfaceDefinition,
} from "./types.ts";

export type SurfaceModule = {
  scoutSurface?: ScoutSurfaceDefinition;
  [exportName: string]: unknown;
};

function isComponentType(value: unknown): value is ComponentType<EmbedScreenProps & Record<string, unknown>> {
  return typeof value === "function";
}

function registerSurface(modulePath: string, mod: SurfaceModule): RegisteredSurface | null {
  const definition = mod.scoutSurface;
  if (!definition?.embed) return null;

  const Screen = mod[definition.screen];
  if (!isComponentType(Screen)) {
    throw new Error(
      `scoutSurface "${definition.id}" in ${modulePath} references screen "${definition.screen}" but no such component export was found.`,
    );
  }

  const embedPath = definition.embed.path ?? defaultEmbedPath(definition.id);
  const aliasPaths = definition.embed.aliases ?? [];
  const embedPaths = [embedPath, ...aliasPaths];

  return {
    ...definition,
    modulePath,
    Screen,
    embedPath,
    embedPaths,
  };
}

export function buildSurfaceRegistry(screenModules: Record<string, SurfaceModule>): {
  surfaces: RegisteredSurface[];
  embedByPath: Map<string, RegisteredSurface>;
} {
  const surfaces: RegisteredSurface[] = [];
  for (const [modulePath, mod] of Object.entries(screenModules)) {
    const registered = registerSurface(modulePath, mod);
    if (registered) surfaces.push(registered);
  }

  surfaces.sort((a, b) => a.id.localeCompare(b.id));

  const embedByPath = new Map<string, RegisteredSurface>();
  for (const surface of surfaces) {
    for (const path of surface.embedPaths) {
      if (embedByPath.has(path)) {
        throw new Error(
          `Duplicate embed path "${path}" registered by "${embedByPath.get(path)!.id}" and "${surface.id}".`,
        );
      }
      embedByPath.set(path, surface);
    }
  }

  return { surfaces, embedByPath };
}