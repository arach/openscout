import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLocalAsset, resolveAssetContentPath } from "./asset-store.ts";

const roots = new Set<string>();

afterEach(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
  roots.clear();
});

function createAssetsDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), "openscout-assets-"));
  roots.add(root);
  return join(root, "assets");
}

describe("asset-store", () => {
  test("creates a content-addressed local image asset from base64", async () => {
    const assetsDirectory = createAssetsDirectory();
    const pngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lOSbNwAAAABJRU5ErkJggg==";

    const asset = await createLocalAsset({
      mediaType: "image/png",
      dataBase64: pngBase64,
      fileName: "capture.png",
      source: "paste",
      actorId: "operator",
    }, {
      assetsDirectory,
      nodeId: "node-1",
      now: () => 123,
    });

    expect(asset.id).toMatch(/^asset-/);
    expect(asset.mediaType).toBe("image/png");
    expect(asset.byteSize).toBeGreaterThan(0);
    expect(asset.sha256).toHaveLength(64);
    expect(asset.storageKey?.startsWith("objects/")).toBe(true);
    expect(asset.fileName).toBe("capture.png");
    expect(asset.originNodeId).toBe("node-1");
    expect(asset.createdAt).toBe(123);

    const contentPath = resolveAssetContentPath(assetsDirectory, asset.storageKey!);
    const stored = await readFile(contentPath);
    expect(stored.equals(Buffer.from(pngBase64, "base64"))).toBe(true);
  });

  test("rejects non-image media types in the first local slice", async () => {
    await expect(createLocalAsset({
      mediaType: "text/plain",
      dataBase64: Buffer.from("hello").toString("base64"),
    }, {
      assetsDirectory: createAssetsDirectory(),
      nodeId: "node-1",
    })).rejects.toThrow(/only image assets/);
  });
});
