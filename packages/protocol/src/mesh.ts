import type { AdvertiseScope, MetadataMap, ScoutId } from "./common.js";

export const OPENSCOUT_MESH_PROTOCOL_VERSION = 1;
export const OPENSCOUT_IROH_MESH_ALPN = "openscout/mesh/0";
export const DEFAULT_OPENSCOUT_MESH_RENDEZVOUS_URL = "https://mesh.openscout.app";

export type NodeMeshEntrypoint =
  | IrohMeshEntrypoint
  | CloudflareTunnelMeshEntrypoint
  | HttpMeshEntrypoint;

export interface IrohMeshEntrypoint {
  kind: "iroh";
  endpointId: string;
  endpointAddr: unknown;
  alpn: typeof OPENSCOUT_IROH_MESH_ALPN;
  bridgeProtocolVersion: typeof OPENSCOUT_MESH_PROTOCOL_VERSION;
  lastSeenAt?: number;
  expiresAt?: number;
  metadata?: MetadataMap;
}

export interface CloudflareTunnelMeshEntrypoint {
  kind: "cloudflare_tunnel";
  url: string;
  lastSeenAt?: number;
  expiresAt?: number;
  metadata?: MetadataMap;
}

export interface HttpMeshEntrypoint {
  kind: "http";
  url: string;
  lastSeenAt?: number;
  expiresAt?: number;
  metadata?: MetadataMap;
}

export interface NodeDefinition {
  id: ScoutId;
  meshId: ScoutId;
  name: string;
  hostName?: string;
  advertiseScope: AdvertiseScope;
  brokerUrl?: string;
  meshEntrypoints?: NodeMeshEntrypoint[];
  tailnetName?: string;
  capabilities?: string[];
  labels?: string[];
  metadata?: MetadataMap;
  lastSeenAt?: number;
  registeredAt: number;
}

export interface OpenScoutMeshPresence {
  v: typeof OPENSCOUT_MESH_PROTOCOL_VERSION;
  meshId: ScoutId;
  nodeId: ScoutId;
  nodeName: string;
  issuedAt: number;
  expiresAt: number;
  entrypoints: NodeMeshEntrypoint[];
  signature?: {
    algorithm: "ed25519";
    keyId: string;
    value: string;
  };
  metadata?: MetadataMap;
}

export interface OpenScoutMeshPresenceRecord extends OpenScoutMeshPresence {
  observedAt: number;
}

export interface OpenScoutMeshRendezvousList {
  v: typeof OPENSCOUT_MESH_PROTOCOL_VERSION;
  meshId: ScoutId;
  nodes: OpenScoutMeshPresenceRecord[];
}

export function buildUnsignedMeshPresence(input: {
  node: Pick<NodeDefinition, "id" | "meshId" | "name">;
  entrypoints: NodeMeshEntrypoint[];
  issuedAt?: number;
  ttlMs?: number;
  metadata?: MetadataMap;
}): OpenScoutMeshPresence {
  const issuedAt = input.issuedAt ?? Date.now();
  const ttlMs = input.ttlMs ?? 60_000;
  return {
    v: OPENSCOUT_MESH_PROTOCOL_VERSION,
    meshId: input.node.meshId,
    nodeId: input.node.id,
    nodeName: input.node.name,
    issuedAt,
    expiresAt: issuedAt + ttlMs,
    entrypoints: input.entrypoints,
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}
