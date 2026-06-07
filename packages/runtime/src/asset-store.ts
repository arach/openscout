import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";

import type {
  AssetRecord,
  AssetRetentionPolicy,
  AssetSource,
  CreateAssetRequest,
  ScoutId,
} from "@openscout/protocol";

export const MAX_LOCAL_IMAGE_ASSET_BYTES = 25 * 1024 * 1024;
const TEMP_FILE_MAX_AGE_MS = 60 * 60 * 1000;

export type CreateLocalAssetOptions = {
  assetsDirectory: string;
  nodeId: ScoutId;
  defaultActorId?: ScoutId;
  allowTrustedLocalPath?: boolean;
  now?: () => number;
};

type LocalAssetBytes = {
  bytes: Buffer;
  fileName?: string;
};

const ASSET_SOURCES = new Set<AssetSource>([
  "paste",
  "screenshot",
  "drag_drop",
  "file",
  "url_capture",
  "audio_recording",
  "agent_output",
  "import",
]);

function trimOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeSource(value: unknown): AssetSource {
  const source = trimOrUndefined(value);
  return source && ASSET_SOURCES.has(source as AssetSource)
    ? source as AssetSource
    : "import";
}

function normalizeRetention(value: unknown): AssetRetentionPolicy | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const retentionClass = trimOrUndefined(record.class);
  if (
    retentionClass !== "ephemeral"
    && retentionClass !== "conversation"
    && retentionClass !== "pinned"
    && retentionClass !== "external_ref"
  ) {
    return undefined;
  }
  const expiresAt = typeof record.expiresAt === "number" && Number.isFinite(record.expiresAt)
    ? record.expiresAt
    : undefined;
  return expiresAt === undefined
    ? { class: retentionClass }
    : { class: retentionClass, expiresAt };
}

function normalizeFileName(value: unknown): string | undefined {
  const name = trimOrUndefined(value);
  if (!name) {
    return undefined;
  }
  return basename(name).slice(0, 255) || undefined;
}

function normalizeMediaType(value: unknown): string {
  const mediaType = trimOrUndefined(value)?.toLowerCase();
  if (!mediaType) {
    throw new Error("mediaType is required");
  }
  if (!mediaType.startsWith("image/")) {
    throw new Error(`only image assets are supported in this phase: ${mediaType}`);
  }
  return mediaType;
}

function normalizeActorId(input: CreateAssetRequest, fallback: ScoutId): ScoutId {
  return trimOrUndefined(input.actorId) ?? fallback;
}

function normalizeNodeId(input: CreateAssetRequest, fallback: ScoutId): ScoutId {
  return trimOrUndefined(input.originNodeId) ?? fallback;
}

function decodeBase64Data(input: string): { bytes: Buffer; mediaType?: string } {
  const dataUrlMatch = input.match(/^data:([^;,]+);base64,(.*)$/s);
  const encoded = dataUrlMatch ? dataUrlMatch[2] ?? "" : input;
  const normalized = encoded.replace(/\s+/g, "");
  if (!normalized) {
    throw new Error("dataBase64 is empty");
  }
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.length === 0) {
    throw new Error("dataBase64 did not decode to bytes");
  }
  return {
    bytes,
    mediaType: dataUrlMatch ? dataUrlMatch[1]?.toLowerCase() : undefined,
  };
}

function sniffImageMediaType(bytes: Buffer): string | undefined {
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 6
    && bytes.subarray(0, 3).toString("ascii") === "GIF"
    && (bytes.subarray(3, 6).toString("ascii") === "87a" || bytes.subarray(3, 6).toString("ascii") === "89a")
  ) {
    return "image/gif";
  }
  if (
    bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return undefined;
}

function equivalentMediaType(left: string, right: string): boolean {
  const normalize = (value: string) => value === "image/jpg" ? "image/jpeg" : value;
  return normalize(left) === normalize(right);
}

async function readInputBytes(
  input: CreateAssetRequest,
  options: CreateLocalAssetOptions,
): Promise<LocalAssetBytes> {
  const dataBase64 = trimOrUndefined(input.dataBase64);
  if (dataBase64) {
    const decoded = decodeBase64Data(dataBase64);
    if (decoded.mediaType && !equivalentMediaType(decoded.mediaType, normalizeMediaType(input.mediaType))) {
      throw new Error(`data URL media type ${decoded.mediaType} does not match ${input.mediaType}`);
    }
    return {
      bytes: decoded.bytes,
      fileName: normalizeFileName(input.fileName),
    };
  }

  const localPath = trimOrUndefined(input.trustedLocalPath);
  if (!localPath) {
    throw new Error("dataBase64 or trustedLocalPath is required");
  }
  if (!options.allowTrustedLocalPath) {
    throw new Error("trustedLocalPath is only accepted from trusted local callers");
  }

  const absolutePath = resolve(localPath);
  const fileStat = await stat(absolutePath);
  if (!fileStat.isFile()) {
    throw new Error("trustedLocalPath must point to a file");
  }
  if (fileStat.size > MAX_LOCAL_IMAGE_ASSET_BYTES) {
    throw new Error(`asset exceeds ${MAX_LOCAL_IMAGE_ASSET_BYTES} byte image limit`);
  }
  return {
    bytes: await readFile(absolutePath),
    fileName: normalizeFileName(input.fileName) ?? basename(absolutePath),
  };
}

function validateImageBytes(mediaType: string, bytes: Buffer): void {
  if (bytes.length > MAX_LOCAL_IMAGE_ASSET_BYTES) {
    throw new Error(`asset exceeds ${MAX_LOCAL_IMAGE_ASSET_BYTES} byte image limit`);
  }
  const sniffed = sniffImageMediaType(bytes);
  if (sniffed && !equivalentMediaType(sniffed, mediaType)) {
    throw new Error(`image bytes look like ${sniffed}, not ${mediaType}`);
  }
}

function storageKeyForSha256(sha256: string): string {
  return join("objects", sha256.slice(0, 2), sha256.slice(2, 4), sha256);
}

export function resolveAssetContentPath(assetsDirectory: string, storageKey: string): string {
  const root = resolve(assetsDirectory);
  const contentPath = resolve(root, storageKey);
  if (contentPath !== root && contentPath.startsWith(`${root}${sep}`)) {
    return contentPath;
  }
  throw new Error("invalid asset storage key");
}

async function writeAssetObject(
  assetsDirectory: string,
  storageKey: string,
  bytes: Buffer,
): Promise<void> {
  const objectPath = resolveAssetContentPath(assetsDirectory, storageKey);
  if (existsSync(objectPath)) {
    return;
  }
  await mkdir(dirname(objectPath), { recursive: true });
  const tempPath = `${objectPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, bytes, { flag: "wx" });
    await rename(tempPath, objectPath);
  } catch (error) {
    await rm(tempPath, { force: true });
    if (existsSync(objectPath)) {
      return;
    }
    throw error;
  }
}

export async function createLocalAsset(
  input: CreateAssetRequest,
  options: CreateLocalAssetOptions,
): Promise<AssetRecord> {
  const mediaType = normalizeMediaType(input.mediaType);
  const { bytes, fileName } = await readInputBytes(input, options);
  validateImageBytes(mediaType, bytes);

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const storageKey = storageKeyForSha256(sha256);
  await writeAssetObject(options.assetsDirectory, storageKey, bytes);

  const now = options.now?.() ?? Date.now();
  return {
    id: trimOrUndefined(input.id) ?? `asset-${randomUUID()}`,
    mediaType,
    byteSize: bytes.length,
    sha256,
    storageKey,
    fileName,
    title: trimOrUndefined(input.title),
    source: normalizeSource(input.source),
    actorId: normalizeActorId(input, options.defaultActorId ?? "operator"),
    originNodeId: normalizeNodeId(input, options.nodeId),
    createdAt: now,
    retention: normalizeRetention(input.retention) ?? { class: "conversation" },
    metadata: input.metadata,
  };
}

async function removeExpiredTempFiles(directory: string, now: number): Promise<number> {
  let removed = 0;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      removed += await removeExpiredTempFiles(entryPath, now);
      continue;
    }
    if (!entry.name.endsWith(".tmp")) {
      continue;
    }
    try {
      const fileStat = await stat(entryPath);
      if (now - fileStat.mtimeMs >= TEMP_FILE_MAX_AGE_MS) {
        await rm(entryPath, { force: true });
        removed += 1;
      }
    } catch {
      // A concurrent writer may have renamed or removed the temp file.
    }
  }
  return removed;
}

export async function sweepAssetStoreTemps(assetsDirectory: string, now = Date.now()): Promise<number> {
  return removeExpiredTempFiles(join(assetsDirectory, "objects"), now);
}
