import type { MetadataMap, ScoutId } from "./common.js";

export type AssetSource =
  | "paste"
  | "screenshot"
  | "drag_drop"
  | "file"
  | "url_capture"
  | "audio_recording"
  | "agent_output"
  | "import";

export type AssetDerivativeKind =
  | "thumbnail"
  | "ocr_text"
  | "transcript"
  | "preview"
  | "waveform";

export interface AssetDerivativeRef {
  id?: ScoutId;
  kind: AssetDerivativeKind;
  assetId?: ScoutId;
  text?: string;
  mediaType?: string;
  createdAt?: number;
  metadata?: MetadataMap;
}

export type AssetRetentionClass =
  | "ephemeral"
  | "conversation"
  | "pinned"
  | "external_ref";

export interface AssetRetentionPolicy {
  class: AssetRetentionClass;
  expiresAt?: number;
}

export interface AssetRecord {
  id: ScoutId;
  mediaType: string;
  byteSize?: number;
  sha256?: string;
  storageKey?: string;
  fileName?: string;
  title?: string;
  source: AssetSource;
  actorId: ScoutId;
  originNodeId: ScoutId;
  createdAt: number;
  updatedAt?: number;
  metadata?: MetadataMap;
  derivatives?: AssetDerivativeRef[];
  retention?: AssetRetentionPolicy;
}

export interface CreateAssetRequest {
  id?: ScoutId;
  mediaType: string;
  fileName?: string;
  title?: string;
  source?: AssetSource;
  actorId?: ScoutId;
  originNodeId?: ScoutId;
  dataBase64?: string;
  trustedLocalPath?: string;
  metadata?: MetadataMap;
  retention?: AssetRetentionPolicy;
}

export interface CreateAssetResponse {
  ok: true;
  asset: AssetRecord;
}
