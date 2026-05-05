/** @type {import('@arach/dewey').DeweyConfig} */
export default {
  project: {
    name: 'OpenScout',
    tagline: 'Local-first agent broker and runtime',
    type: 'monorepo',
    version: '0.2.65',
  },

  agent: {
    criticalContext: [
      'OpenScout is pilot-worthy for high-trust local developer environments, not enterprise-ready.',
      'The broker is the canonical writer for Scout-owned coordination records.',
      'Scout owns messages, invocations, flights, deliveries, bindings, agent registrations, questions, and work items created through Scout.',
      'Scout observes external harness transcripts such as Claude Code and Codex JSONL; it must not bulk-import those turns as first-party Scout messages.',
      'Mesh means reachability and coordination across machines, not exactly-once delivery, global consensus, or transcript replication.',
      'All record types are defined in @openscout/protocol.',
      'The CLI command is `scout`, not `openscout`.',
      'Use messages_send / scout send for tell/update and invocations_ask / scout ask for owned work or requested replies.',
    ],
    entryPoints: {
      'cli': 'apps/desktop/',
      'runtime': 'packages/runtime/',
      'protocol': 'packages/protocol/',
      'desktop': 'apps/desktop/',
      'ios': 'apps/ios/',
      'web': 'packages/web/',
      'docs': 'docs/',
    },
    rules: [
      { pattern: 'broker', instruction: 'Check packages/runtime/src/broker.ts, packages/runtime/src/scout-broker.ts, and packages/runtime/src/broker-daemon.ts' },
      { pattern: 'agent identity', instruction: 'See docs/agent-identity.md for address grammar' },
      { pattern: 'agent integration', instruction: 'See docs/agent-integration-contract.md before adding a new adapter or agent-facing surface' },
      { pattern: 'collaboration', instruction: 'See docs/collaboration-workflows-v1.md' },
      { pattern: 'data ownership', instruction: 'See docs/data-ownership.md before persisting harness transcript data' },
      { pattern: 'trust or security', instruction: 'See docs/current-posture.md and docs/operator-attention-and-unblock.md before making maturity claims' },
    ],
    sections: [
      'quickstart',
      'current-posture',
      'architecture',
      'data-ownership',
      'agent-integration-contract',
      'agent-identity',
      'collaboration-workflows-v1',
      'operator-attention-and-unblock',
    ],
  },

  docs: {
    path: './docs',
    output: './',
    required: [
      'quickstart',
      'current-posture',
      'architecture',
      'data-ownership',
      'agent-integration-contract',
    ],
  },

  install: {
    objective: 'Install the Scout CLI and bootstrap the local broker.',
    doneWhen: {
      command: 'scout doctor',
      expectedOutput: 'broker healthy',
    },
    prerequisites: [
      'Bun >= 1.3',
      'macOS for the full desktop/service bootstrap path',
    ],
    steps: [
      { description: 'Install the Scout package globally', command: 'bun add -g @openscout/scout' },
      { description: 'Bootstrap local settings and broker', command: 'scout setup' },
      { description: 'Verify broker health', command: 'scout doctor' },
    ],
  },
}
