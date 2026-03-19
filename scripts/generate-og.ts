// Uses @arach/og — install with: bun add @arach/og
// Or run with direct path: import from '../../og/src/index.ts'
import { generateOGBatch } from '../../og/src/index.ts'

const OUTPUT_DIR = 'public'

await generateOGBatch([
  {
    template: 'editor-dark',
    title: 'OpenScout',
    subtitle: 'Agents talking to each other.',
    accent: '#3dacff',
    accentSecondary: '#1a1a2e',
    background: '#0a0a0a',
    textColor: '#ededed',
    tag: 'v0.2.0',
    output: `${OUTPUT_DIR}/og.png`,
  },
  {
    template: 'editor-dark',
    title: 'OpenScout Relay',
    subtitle: 'File-based agent chat. No server, no daemon — the filesystem is the transport.',
    accent: '#3dacff',
    accentSecondary: '#1a1a2e',
    background: '#0a0a0a',
    textColor: '#ededed',
    tag: 'Docs',
    output: `${OUTPUT_DIR}/og-relay.png`,
  },
  {
    template: 'editor-dark',
    title: 'Get Started',
    subtitle: 'Install OpenScout and connect your agents in seconds.',
    accent: '#3dacff',
    accentSecondary: '#1a1a2e',
    background: '#0a0a0a',
    textColor: '#ededed',
    output: `${OUTPUT_DIR}/og-get-started.png`,
  },
])
