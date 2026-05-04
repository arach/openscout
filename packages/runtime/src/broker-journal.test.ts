import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  ActorIdentity,
  AgentDefinition,
  FlightRecord,
  InvocationRequest,
  MessageRecord,
} from "@openscout/protocol";

import { FileBackedBrokerJournal } from "./broker-journal.ts";

const journalRoots = new Set<string>();

afterEach(() => {
  for (const root of journalRoots) {
    rmSync(root, { recursive: true, force: true });
  }
  journalRoots.clear();
});

function createJournal(): { journal: FileBackedBrokerJournal; journalPath: string } {
  const root = mkdtempSync(join(tmpdir(), "openscout-broker-journal-"));
  journalRoots.add(root);
  const journalPath = join(root, "broker-journal.jsonl");
  return {
    journal: new FileBackedBrokerJournal(journalPath),
    journalPath,
  };
}

function sampleActor(): ActorIdentity {
  return {
    id: "agent-1",
    kind: "agent",
    displayName: "Agent One",
    handle: "agent-one",
    labels: ["builder"],
    metadata: {
      workspace: "/tmp/agent-one",
    },
  };
}

function sampleAgent(): AgentDefinition {
  return {
    ...sampleActor(),
    kind: "agent",
    definitionId: "agent-1",
    agentClass: "builder",
    capabilities: ["chat", "execute"],
    wakePolicy: "on_demand",
    homeNodeId: "node-1",
    authorityNodeId: "node-1",
    advertiseScope: "local",
  };
}

function sampleMessage(): MessageRecord {
  return {
    id: "msg-1",
    conversationId: "conv-1",
    actorId: "operator",
    originNodeId: "node-1",
    class: "agent",
    body: "hello",
    visibility: "private",
    policy: "durable",
    createdAt: 1_700_000_000_000,
  };
}

function sampleInvocation(): InvocationRequest {
  return {
    id: "inv-1",
    requesterId: "operator",
    requesterNodeId: "node-1",
    targetAgentId: "agent-1",
    action: "execute",
    task: "Run the issue runner.",
    ensureAwake: true,
    stream: true,
    createdAt: 1_700_000_000_001,
  };
}

function sampleFlight(): FlightRecord {
  return {
    id: "flt-1",
    invocationId: "inv-1",
    requesterId: "operator",
    targetAgentId: "agent-1",
    state: "running",
    summary: "Running issue work.",
    startedAt: 1_700_000_000_002,
  };
}

describe("FileBackedBrokerJournal", () => {
  test("skips redundant entity upserts on append", async () => {
    const { journal, journalPath } = createJournal();
    await journal.load();

    const first = await journal.appendEntries([
      { kind: "actor.upsert", actor: sampleActor() },
      { kind: "agent.upsert", agent: sampleAgent() },
    ]);
    const second = await journal.appendEntries([
      { kind: "actor.upsert", actor: sampleActor() },
      { kind: "agent.upsert", agent: sampleAgent() },
    ]);

    expect(first).toHaveLength(2);
    expect(second).toHaveLength(0);

    const lines = readFileSync(journalPath, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { kind: string });

    expect(lines.filter((entry) => entry.kind === "actor.upsert")).toHaveLength(1);
    expect(lines.filter((entry) => entry.kind === "agent.upsert")).toHaveLength(1);
  });

  test("compacts superseded upserts on load while preserving non-upsert entries", async () => {
    const { journal, journalPath } = createJournal();
    const actor = sampleActor();
    const updatedActor = {
      ...actor,
      displayName: "Agent One Updated",
    };

    writeFileSync(
      journalPath,
      [
        JSON.stringify({ kind: "actor.upsert", actor }),
        JSON.stringify({ kind: "message.record", message: sampleMessage() }),
        JSON.stringify({ kind: "actor.upsert", actor: updatedActor }),
      ].join("\n") + "\n",
      "utf8",
    );

    await journal.load();

    const compactedEntries = await journal.readEntries();
    expect(compactedEntries).toHaveLength(2);
    expect(compactedEntries.filter((entry) => entry.kind === "actor.upsert")).toHaveLength(1);
    expect(compactedEntries.filter((entry) => entry.kind === "message.record")).toHaveLength(1);
    expect(journal.snapshot().actors["agent-1"]?.displayName).toBe("Agent One Updated");
  });

  test("replays invocation records into snapshots", async () => {
    const { journal, journalPath } = createJournal();

    writeFileSync(
      journalPath,
      [
        JSON.stringify({ kind: "invocation.record", invocation: sampleInvocation() }),
        JSON.stringify({ kind: "flight.record", flight: sampleFlight() }),
      ].join("\n") + "\n",
      "utf8",
    );

    await journal.load();

    const snapshot = journal.snapshot();
    expect(snapshot.invocations["inv-1"]).toEqual(expect.objectContaining({
      targetAgentId: "agent-1",
    }));
    expect(snapshot.flights["flt-1"]).toEqual(expect.objectContaining({
      invocationId: "inv-1",
    }));
  });
});
