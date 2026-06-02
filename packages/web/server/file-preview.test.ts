import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  readFilePreview,
  resolveTrustedPath,
  type TrustedRoot,
} from "./file-preview.ts";

const cleanup: string[] = [];

afterEach(() => {
  while (cleanup.length > 0) {
    const path = cleanup.pop();
    if (path) rmSync(path, { force: true, recursive: true });
  }
});

function makeRoot(prefix = "openscout-file-preview-"): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(root);
  return root;
}

function trustedRoot(path: string): TrustedRoot {
  return { path: realpathSync(path), source: "current-directory" };
}

describe("file preview path resolution", () => {
  test("resolves relative paths inside a trusted workspace root", () => {
    const root = makeRoot();
    mkdirSync(join(root, "src"), { recursive: true });
    const filePath = join(root, "src", "app.ts");
    writeFileSync(filePath, "export const app = true;\n", "utf8");

    const result = resolveTrustedPath({
      requestedPath: "src/app.ts",
      roots: [trustedRoot(root)],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.realPath).toBe(realpathSync(filePath));
      expect(result.root.path).toBe(realpathSync(root));
    }
  });

  test("rejects symlinks that resolve outside trusted roots", () => {
    const root = makeRoot();
    const outside = makeRoot("openscout-file-preview-outside-");
    const outsideFile = join(outside, "secret.txt");
    writeFileSync(outsideFile, "do not leak\n", "utf8");
    const linkPath = join(root, "secret.txt");
    symlinkSync(outsideFile, linkPath);

    const result = resolveTrustedPath({
      requestedPath: linkPath,
      roots: [trustedRoot(root)],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
    }
  });
});

describe("readFilePreview", () => {
  test("returns directory entries sorted with folders first", () => {
    const root = makeRoot();
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "README.md"), "# Hello\n", "utf8");

    const result = readFilePreview({ requestedPath: root, currentDirectory: root });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content.kind).toBe("directory");
      if (result.content.kind === "directory") {
        expect(result.content.entries.map((entry) => `${entry.kind}:${entry.name}`)).toEqual([
          "directory:docs",
          "file:README.md",
        ]);
      }
    }
  });

  test("returns raw media metadata without a text payload", () => {
    const root = makeRoot();
    const imagePath = join(root, "preview.png");
    writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]));

    const result = readFilePreview({ requestedPath: imagePath, currentDirectory: root });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content.kind).toBe("file");
      expect(result.content.previewable).toBe(false);
      expect(result.content.mediaType).toBe("image/png");
      expect(result.content.sizeBytes).toBe(5);
      expect("content" in result.content).toBe(false);
    }
  });

  test("truncates large text previews using the preview byte limit", () => {
    const root = makeRoot();
    const logPath = join(root, "large.log");
    const body = "x".repeat(300 * 1024);
    writeFileSync(logPath, body, "utf8");

    const result = readFilePreview({ requestedPath: logPath, currentDirectory: root });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content.kind).toBe("file");
      expect(result.content.previewable).toBe(true);
      if (result.content.previewable) {
        expect(result.content.truncated).toBe(true);
        expect(result.content.sizeBytes).toBe(body.length);
        expect(result.content.content.length).toBeLessThan(body.length);
      }
    }
  });
});

describe("readFilePreview line range slicing", () => {
  function writeNumberedDoc(root: string, name = "spec.md", lines = 80): string {
    const body = Array.from({ length: lines }, (_, idx) => `line ${idx + 1}`).join("\n");
    const filePath = join(root, name);
    writeFileSync(filePath, body, "utf8");
    return filePath;
  }

  test("returns the full file when no range is provided", () => {
    const root = makeRoot();
    const filePath = writeNumberedDoc(root);
    const result = readFilePreview({ requestedPath: filePath, currentDirectory: root });

    expect(result.ok).toBe(true);
    if (result.ok && result.content.kind === "file" && result.content.previewable) {
      expect(result.content.range).toBeUndefined();
      expect(result.content.totalLines).toBeUndefined();
      expect(result.content.content.split("\n").length).toBe(80);
    }
  });

  test("slices a multi-line range inclusively and surfaces the clamped range", () => {
    const root = makeRoot();
    const filePath = writeNumberedDoc(root);
    const result = readFilePreview({
      requestedPath: filePath,
      currentDirectory: root,
      range: { start: 43, end: 59 },
    });

    expect(result.ok).toBe(true);
    if (result.ok && result.content.kind === "file" && result.content.previewable) {
      expect(result.content.range).toEqual({ start: 43, end: 59 });
      expect(result.content.totalLines).toBe(80);
      const lines = result.content.content.split("\n");
      expect(lines.length).toBe(59 - 43 + 1);
      expect(lines[0]).toBe("line 43");
      expect(lines[lines.length - 1]).toBe("line 59");
    }
  });

  test("supports a single-line range (start = end)", () => {
    const root = makeRoot();
    const filePath = writeNumberedDoc(root);
    const result = readFilePreview({
      requestedPath: filePath,
      currentDirectory: root,
      range: { start: 17, end: 17 },
    });

    expect(result.ok).toBe(true);
    if (result.ok && result.content.kind === "file" && result.content.previewable) {
      expect(result.content.range).toEqual({ start: 17, end: 17 });
      expect(result.content.content).toBe("line 17");
    }
  });

  test("clamps a range whose end overruns the file", () => {
    const root = makeRoot();
    const filePath = writeNumberedDoc(root, "spec.md", 20);
    const result = readFilePreview({
      requestedPath: filePath,
      currentDirectory: root,
      range: { start: 15, end: 200 },
    });

    expect(result.ok).toBe(true);
    if (result.ok && result.content.kind === "file" && result.content.previewable) {
      expect(result.content.range).toEqual({ start: 15, end: 20 });
      expect(result.content.totalLines).toBe(20);
      const lines = result.content.content.split("\n");
      expect(lines[0]).toBe("line 15");
      expect(lines[lines.length - 1]).toBe("line 20");
    }
  });

  test("returns the full file when the range starts past the end", () => {
    const root = makeRoot();
    const filePath = writeNumberedDoc(root, "spec.md", 10);
    const result = readFilePreview({
      requestedPath: filePath,
      currentDirectory: root,
      range: { start: 500, end: 600 },
    });

    expect(result.ok).toBe(true);
    if (result.ok && result.content.kind === "file" && result.content.previewable) {
      expect(result.content.range).toBeUndefined();
      expect(result.content.content.split("\n").length).toBe(10);
    }
  });

  test("ignores range for binary media payloads", () => {
    const root = makeRoot();
    const imagePath = join(root, "pic.png");
    writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]));

    const result = readFilePreview({
      requestedPath: imagePath,
      currentDirectory: root,
      range: { start: 1, end: 5 },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content.kind).toBe("file");
      expect(result.content.previewable).toBe(false);
      // Range fields only appear on previewable text content.
      expect("range" in result.content).toBe(false);
    }
  });
});
