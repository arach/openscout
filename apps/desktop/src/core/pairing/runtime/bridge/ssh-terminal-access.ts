import { createHash } from "crypto";

const SCOUT_AUTHORIZED_KEY_MARKER = "scout:terminal-access:v0";
const SSH_PUBLIC_KEY_PREFIX = "ssh-";

const SUPPORTED_IOS_PUBLIC_KEY_ALGORITHMS = new Set([
  "ssh-ed25519",
  "ecdsa-sha2-nistp256",
  "ecdsa-sha2-nistp384",
  "ecdsa-sha2-nistp521",
  "rsa-sha2-256",
  "rsa-sha2-512",
  "ssh-rsa",
]);

export type SshPublicKeyAlgorithm =
  | "ssh-ed25519"
  | "ecdsa-sha2-nistp256"
  | "ecdsa-sha2-nistp384"
  | "ecdsa-sha2-nistp521"
  | "rsa-sha2-256"
  | "rsa-sha2-512"
  | "ssh-rsa";

export interface ValidatedSshPublicKey {
  algorithm: SshPublicKeyAlgorithm;
  keyData: string;
  fingerprintSha256: string;
  normalizedPublicKey: string;
}

export interface SshTerminalAccessGrant {
  deviceId: string;
  sshPublicKey: ValidatedSshPublicKey;
  pairingNoisePublicKey?: string;
  pairingNoiseFingerprintSha256?: string;
  authorizedKeyLine: string;
}

export interface SshTerminalAccessProvisionInput {
  authorizedKeys: string;
  deviceId: string;
  sshPublicKey: string;
  /**
   * Pairing Noise key that authorized this provisioning request. It is recorded
   * only as a fingerprint so SSH credentials remain separate from pairing
   * transport identity and no Noise secret/key material is persisted here.
   */
  pairingNoisePublicKey?: string;
}

export interface SshTerminalAccessProvisionResult {
  authorizedKeys: string;
  changed: boolean;
  grant: SshTerminalAccessGrant;
}

export interface SshTerminalAccessRevokeInput {
  authorizedKeys: string;
  deviceId: string;
}

export interface SshTerminalAccessRevokeResult {
  authorizedKeys: string;
  changed: boolean;
  removed: number;
}

export interface SshHostKeyPin {
  algorithm: SshPublicKeyAlgorithm;
  fingerprintSha256: string;
  publicKey: string;
  source: "local-host-ssh-key";
}

export function validateIosGeneratedSshPublicKey(publicKey: string): ValidatedSshPublicKey {
  const fields = publicKey.trim().split(/\s+/);
  if (fields.length < 2) {
    throw new Error("SSH public key must include an algorithm and key data");
  }

  const [algorithm, keyData] = fields;
  if (!algorithm.startsWith(SSH_PUBLIC_KEY_PREFIX)) {
    throw new Error("SSH public key algorithm is missing or invalid");
  }
  if (!isSupportedIosPublicKeyAlgorithm(algorithm)) {
    throw new Error(`Unsupported SSH public key algorithm: ${algorithm}`);
  }
  if (!isValidBase64KeyData(keyData)) {
    throw new Error("SSH public key data must be valid base64");
  }
  if (readSshWireString(Buffer.from(keyData, "base64"), 0)?.value !== algorithm) {
    throw new Error("SSH public key data does not match its declared algorithm");
  }

  return {
    algorithm,
    keyData,
    fingerprintSha256: fingerprintKeyData(keyData),
    normalizedPublicKey: `${algorithm} ${keyData}`,
  };
}

export function createSshHostKeyPin(publicKey: string): SshHostKeyPin {
  const validated = validateIosGeneratedSshPublicKey(publicKey);
  return {
    algorithm: validated.algorithm,
    fingerprintSha256: validated.fingerprintSha256,
    publicKey: validated.normalizedPublicKey,
    source: "local-host-ssh-key",
  };
}

export function provisionSshTerminalAccess(
  input: SshTerminalAccessProvisionInput,
): SshTerminalAccessProvisionResult {
  const deviceId = normalizeDeviceId(input.deviceId);
  const sshPublicKey = validateIosGeneratedSshPublicKey(input.sshPublicKey);
  const pairingNoiseFingerprintSha256 = input.pairingNoisePublicKey
    ? fingerprintUtf8(input.pairingNoisePublicKey.trim())
    : undefined;
  const grant: SshTerminalAccessGrant = {
    deviceId,
    sshPublicKey,
    pairingNoisePublicKey: input.pairingNoisePublicKey?.trim(),
    pairingNoiseFingerprintSha256,
    authorizedKeyLine: createScoutAuthorizedKeyLine({
      deviceId,
      sshPublicKey,
      pairingNoiseFingerprintSha256,
    }),
  };

  const withoutExistingDeviceGrant = removeScoutAuthorizedKeysForDevice(
    splitAuthorizedKeys(input.authorizedKeys),
    deviceId,
  );
  const nextLines = [...withoutExistingDeviceGrant.lines, grant.authorizedKeyLine];
  const nextAuthorizedKeys = joinAuthorizedKeyLines(nextLines);

  return {
    authorizedKeys: nextAuthorizedKeys,
    changed: normalizeAuthorizedKeys(input.authorizedKeys) !== nextAuthorizedKeys,
    grant,
  };
}

export function revokeSshTerminalAccess(
  input: SshTerminalAccessRevokeInput,
): SshTerminalAccessRevokeResult {
  const deviceId = normalizeDeviceId(input.deviceId);
  const removal = removeScoutAuthorizedKeysForDevice(
    splitAuthorizedKeys(input.authorizedKeys),
    deviceId,
  );
  const authorizedKeys = joinAuthorizedKeyLines(removal.lines);
  return {
    authorizedKeys,
    changed: removal.removed > 0,
    removed: removal.removed,
  };
}

export function isScoutManagedAuthorizedKeyForDevice(
  line: string,
  deviceId: string,
): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return false;
  const marker = parseScoutAuthorizedKeyMarker(trimmed);
  return marker?.device === encodeMarkerValue(normalizeDeviceId(deviceId));
}

function createScoutAuthorizedKeyLine(input: {
  deviceId: string;
  sshPublicKey: ValidatedSshPublicKey;
  pairingNoiseFingerprintSha256?: string;
}): string {
  const marker = [
    SCOUT_AUTHORIZED_KEY_MARKER,
    `device=${encodeMarkerValue(input.deviceId)}`,
    `ssh=${input.sshPublicKey.fingerprintSha256}`,
    `pairing=${input.pairingNoiseFingerprintSha256 ?? "unbound"}`,
  ].join(" ");
  return `${input.sshPublicKey.normalizedPublicKey} ${marker}`;
}

function removeScoutAuthorizedKeysForDevice(
  lines: string[],
  deviceId: string,
): { lines: string[]; removed: number } {
  const retained: string[] = [];
  let removed = 0;
  for (const line of lines) {
    if (isScoutManagedAuthorizedKeyForDevice(line, deviceId)) {
      removed += 1;
    } else {
      retained.push(line);
    }
  }
  return { lines: retained, removed };
}

function parseScoutAuthorizedKeyMarker(line: string): { device?: string } | null {
  const fields = line.trim().split(/\s+/);
  const markerIndex = fields.indexOf(SCOUT_AUTHORIZED_KEY_MARKER);
  if (markerIndex === -1) return null;

  const marker: { device?: string } = {};
  for (const field of fields.slice(markerIndex + 1)) {
    const [key, value] = field.split("=", 2);
    if (key === "device") {
      marker.device = value;
    }
  }
  return marker;
}

function normalizeDeviceId(deviceId: string): string {
  const normalized = deviceId.trim();
  if (!normalized) {
    throw new Error("Device id is required for SSH terminal access provisioning");
  }
  return normalized;
}

function splitAuthorizedKeys(authorizedKeys: string): string[] {
  if (authorizedKeys.length === 0) return [];
  const lines = authorizedKeys
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

function joinAuthorizedKeyLines(lines: string[]): string {
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

function normalizeAuthorizedKeys(authorizedKeys: string): string {
  return joinAuthorizedKeyLines(splitAuthorizedKeys(authorizedKeys));
}

function isSupportedIosPublicKeyAlgorithm(
  algorithm: string,
): algorithm is SshPublicKeyAlgorithm {
  return SUPPORTED_IOS_PUBLIC_KEY_ALGORITHMS.has(algorithm);
}

function isValidBase64KeyData(keyData: string): boolean {
  try {
    const decoded = Buffer.from(keyData, "base64");
    return decoded.length > 0
      && decoded.toString("base64").replace(/=+$/, "") === keyData.replace(/=+$/, "");
  } catch {
    return false;
  }
}

function readSshWireString(
  buffer: Buffer,
  offset: number,
): { value: string; nextOffset: number } | null {
  if (offset + 4 > buffer.length) return null;
  const length = buffer.readUInt32BE(offset);
  const start = offset + 4;
  const end = start + length;
  if (end > buffer.length) return null;
  return {
    value: buffer.subarray(start, end).toString("utf8"),
    nextOffset: end,
  };
}

function fingerprintKeyData(keyData: string): string {
  return `SHA256:${createHash("sha256").update(Buffer.from(keyData, "base64")).digest("base64").replace(/=+$/, "")}`;
}

function fingerprintUtf8(value: string): string {
  return `SHA256:${createHash("sha256").update(value, "utf8").digest("base64").replace(/=+$/, "")}`;
}

function encodeMarkerValue(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}
