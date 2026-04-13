/** @type {import('@arach/dewey').DeweyConfig} */
export default {
  project: {
    name: 'OpenScout',
    tagline: 'Local-first agent broker and runtime',
    type: 'monorepo',
    version: '0.2.2',
  },

  agent: {
    criticalContext: [
      'The broker is the single source of truth for all agent communication.',
      'Messages, invocations, flights, deliveries, and bindings are the five core record types.',
      'All record types are defined in @openscout/protocol.',
      'The CLI command is `scout`, not `openscout`.',
    ],
    entryPoints: {
      'cli': 'apps/desktop/',
      'runtime': 'packages/runtime/',
      'protocol': 'packages/protocol/',
      'desktop': 'apps/desktop/',
    },
    rules: [
      { pattern: 'broker', instruction: 'Check packages/runtime/src/broker.ts and scout-broker.ts' },
      { pattern: 'agent identity', instruction: 'See docs/agent-identity.md for address grammar' },
      { pattern: 'collaboration', instruction: 'See docs/collaboration-workflows-v1.md' },
    ],
    sections: ['overview', 'quickstart', 'architecture'],
  },

  docs: {
    path: './docs',
    output: './',
    required: ['overview', 'quickstart'],
  },

  install: {
    objective: 'Install the Scout CLI and bootstrap the local broker.',
    doneWhen: {
      command: 'scout doctor',
      expectedOutput: 'broker healthy',
    },
    prerequisites: [
      'Bun >= 1.0 or Node.js >= 20',
    ],
    steps: [
      { description: 'Install the Scout package globally', command: 'bun add -g @openscout/scout' },
      { description: 'Bootstrap local settings and broker', command: 'scout setup' },
      { description: 'Verify broker health', command: 'scout doctor' },
    ],
  },
}
