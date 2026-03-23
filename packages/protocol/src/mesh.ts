import type { AdvertiseScope, MetadataMap, ScoutId } from "./common.js";

export interface NodeDefinition {
  id: ScoutId;
  meshId: ScoutId;
  name: string;
  hostName?: string;
  advertiseScope: AdvertiseScope;
  brokerUrl?: string;
  tailnetName?: string;
  capabilities?: string[];
  labels?: string[];
  metadata?: MetadataMap;
  lastSeenAt?: number;
  registeredAt: number;
}
