import type { ArcDiagramData } from '@arach/arc-viewer'

export const relayArchitectureDiagram: ArcDiagramData = {
  id: '',
  layout: { width: 660, height: 316 },
  nodes: {
    desktop: { x: 18, y: 28, size: 's' },
    cli: { x: 18, y: 118, size: 's' },
    bindings: { x: 18, y: 208, size: 's' },
    runtime: { x: 214, y: 96, size: 'm' },
    state: { x: 494, y: 28, size: 's' },
    agents: { x: 494, y: 118, size: 's' },
    peer: { x: 494, y: 208, size: 's' },
  },
  nodeData: {
    desktop: {
      icon: 'Monitor',
      name: 'Desktop',
      subtitle: 'operator UI',
      color: 'violet',
    },
    cli: {
      icon: 'Terminal',
      name: 'CLI + Relay',
      subtitle: 'scout / relay',
      color: 'blue',
    },
    bindings: {
      icon: 'MessageSquare',
      name: 'Bindings',
      subtitle: 'voice / chat',
      color: 'amber',
    },
    runtime: {
      icon: 'Server',
      name: 'Shared runtime',
      subtitle: 'messages + routing + work',
      description: 'The communication loop for local and remote agents.',
      color: 'emerald',
    },
    state: {
      icon: 'Database',
      name: 'State',
      subtitle: 'SQLite + events',
      color: 'blue',
    },
    agents: {
      icon: 'Bot',
      name: 'Agents',
      subtitle: 'Claude · Codex · Pi',
      color: 'rose',
    },
    peer: {
      icon: 'Globe',
      name: 'Peer runtime',
      subtitle: 'another machine',
      color: 'zinc',
    },
  },
  connectors: [
    { from: 'desktop', to: 'runtime', fromAnchor: 'right', toAnchor: 'left', style: 'surface' },
    { from: 'cli', to: 'runtime', fromAnchor: 'right', toAnchor: 'left', style: 'surface' },
    { from: 'bindings', to: 'runtime', fromAnchor: 'right', toAnchor: 'left', style: 'binding' },
    { from: 'runtime', to: 'state', fromAnchor: 'topRight', toAnchor: 'left', style: 'persist' },
    { from: 'runtime', to: 'agents', fromAnchor: 'right', toAnchor: 'left', style: 'route' },
    { from: 'runtime', to: 'peer', fromAnchor: 'bottomRight', toAnchor: 'left', style: 'mesh', curve: 'natural' },
  ],
  connectorStyles: {
    surface: { color: 'violet', strokeWidth: 2, label: 'interface' },
    binding: { color: 'amber', strokeWidth: 2, label: 'bind' },
    persist: { color: 'blue', strokeWidth: 2, label: 'persist' },
    route: { color: 'emerald', strokeWidth: 2, label: 'deliver' },
    mesh: { color: 'zinc', strokeWidth: 2, label: 'peer', dashed: true },
  },
}
