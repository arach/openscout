import docsJson from '../../docs.json'

export type NavItem = {
  title: string
  href: string
}

export type NavGroup = {
  id: string
  title: string
  items: NavItem[]
}

type DocsJson = {
  groups: Array<{
    id: string
    title: string
    items: Array<{
      id: string
      title: string
    }>
  }>
}

const docs = docsJson as DocsJson

export const navGroups: NavGroup[] = docs.groups.map((group) => ({
  id: group.id,
  title: group.title,
  items: group.items.map((item) => ({
    title: item.title,
    href: '/docs/relay/docs/' + item.id,
  })),
}))
