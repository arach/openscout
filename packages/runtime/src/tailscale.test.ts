import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  readTailscalePeers,
  readTailscaleSelf,
  readTailscaleStatusSummary,
} from "./tailscale";

const originalFixturePath = process.env.OPENSCOUT_TAILSCALE_STATUS_JSON;
const tempDirectories = new Set<string>();

afterEach(() => {
  if (originalFixturePath === undefined) {
    delete process.env.OPENSCOUT_TAILSCALE_STATUS_JSON;
  } else {
    process.env.OPENSCOUT_TAILSCALE_STATUS_JSON = originalFixturePath;
  }

  for (const directory of tempDirectories) {
    rmSync(directory, { recursive: true, force: true });
  }
  tempDirectories.clear();
});

function writeFixture(body: unknown): string {
  const directory = mkdtempSync(join(tmpdir(), "openscout-tailscale-"));
  tempDirectories.add(directory);
  const filePath = join(directory, "status.json");
  writeFileSync(filePath, JSON.stringify(body, null, 2), "utf8");
  return filePath;
}

describe("tailscale status readers", () => {
  test("reads peer candidates and self identity from a status fixture", async () => {
    process.env.OPENSCOUT_TAILSCALE_STATUS_JSON = writeFixture({
      BackendState: "Stopped",
      Health: ["Tailscale is stopped."],
      Self: {
        ID: "self-node",
        HostName: "workstation",
        DNSName: "workstation.tailnet.ts.net.",
        TailscaleIPs: ["100.64.0.10"],
        Online: true,
        OS: "macOS",
      },
      CurrentTailnet: {
        Name: "example.tailnet",
        MagicDNSSuffix: "tailnet.ts.net",
      },
      Peer: {
        peerA: {
          ID: "peer-a",
          HostName: "laptop",
          DNSName: "laptop.tailnet.ts.net.",
          TailscaleIPs: ["100.64.0.11"],
          Online: true,
          OS: "macOS",
          Tags: ["tag:dev"],
        },
      },
    });

    const [peers, self, summary] = await Promise.all([
      readTailscalePeers(),
      readTailscaleSelf(),
      readTailscaleStatusSummary(),
    ]);

    expect(peers).toEqual([
      {
        id: "peer-a",
        name: "laptop",
        dnsName: "laptop.tailnet.ts.net.",
        addresses: ["100.64.0.11"],
        online: true,
        hostName: "laptop",
        os: "macOS",
        tags: ["tag:dev"],
      },
    ]);

    expect(self).toEqual({
      id: "self-node",
      name: "workstation",
      dnsName: "workstation.tailnet.ts.net.",
      addresses: ["100.64.0.10"],
      online: true,
      hostName: "workstation",
      os: "macOS",
      tailnetName: "example.tailnet",
      magicDnsSuffix: "tailnet.ts.net",
    });

    expect(summary).toEqual({
      backendState: "Stopped",
      running: false,
      health: ["Tailscale is stopped."],
      peers,
      self,
    });
  });
});
