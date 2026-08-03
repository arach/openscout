"use client";

import { useState } from "react";
import {
  AGENT_HOSTS,
  AgentsSurface,
  CURRENT_PHONE_TABS,
  MastheadHostQualifier,
  Seg,
  SurfaceLab,
  UnifiedAgentsSurface,
  type AgentHostId,
  type MastheadDotLayout,
  type MastheadHexStyle,
  type UnifiedAgentScope,
} from "@/components/scout-ios";

export default function ScoutIOSAgentsStudy() {
  // Source-faithful control for the Observe boundary question. The shipped
  // second slot is named Agents, but PROJECT renders project headers with agent
  // leaves while RECENT renders a flat agent list. AgentsSurface.swift has no
  // regular-width branch today, so the iPad exhibit intentionally stretches the
  // same mixed noun model instead of inventing a tablet redesign.
  const [sort, setSort] = useState<"project" | "recent">("project");
  const [selectedHostIds, setSelectedHostIds] = useState<AgentHostId[]>(() => AGENT_HOSTS.map((host) => host.id));
  const [scope, setScope] = useState<UnifiedAgentScope>("all");
  const [phoneHostsOpen, setPhoneHostsOpen] = useState(false);
  const [wideHostsOpen, setWideHostsOpen] = useState(false);
  const [hostCount, setHostCount] = useState(4);
  const [dotLayout, setDotLayout] = useState<MastheadDotLayout>("cluster");
  const scopedHosts = AGENT_HOSTS.slice(0, hostCount);
  const scopedHostIds = selectedHostIds.filter((id) => scopedHosts.some((host) => host.id === id));

  const unified = () => (
    <UnifiedAgentsSurface
      sort={sort}
      onSort={setSort}
      hosts={scopedHosts}
      selectedHostIds={scopedHostIds}
      scope={scope}
      onScope={setScope}
    />
  );

  const qualifier = (markStyle: MastheadHexStyle, wide = false) => (
    <MastheadHostQualifier
      hosts={scopedHosts}
      selectedHostIds={scopedHostIds}
      onSelectedHostIds={setSelectedHostIds}
      open={wide ? wideHostsOpen : phoneHostsOpen}
      onOpen={wide ? setWideHostsOpen : setPhoneHostsOpen}
      markStyle={markStyle}
      dotLayout={dotLayout}
    />
  );

  const changeHostCount = (value: string) => {
    const count = Number(value);
    setHostCount(count);
    setSelectedHostIds(AGENT_HOSTS.slice(0, count).map((host) => host.id));
    setPhoneHostsOpen(false);
    setWideHostsOpen(false);
  };

  return (
    <SurfaceLab
      surface="agents"
      title="Scout iOS · Agents / Projects"
      blurb="The source-faithful second iOS destination plus two council-designed unified-overview proposals at phone and iPad widths. Host context is shared masthead scope beside Scout—not a card, rail, or destination in the page. PROJECT and RECENT keep one row grammar; CHANGED makes Observe a filter over it."
      source="apps/ios/Scout/AgentsSurface.swift"
      tabs={CURRENT_PHONE_TABS}
      controls={(
        <>
          <Seg
            label="Hosts"
            value={String(hostCount)}
            onChange={changeHostCount}
            options={[1, 2, 3, 4].map((count) => ({ id: String(count), label: String(count) }))}
          />
          <Seg
            label="Dot layout"
            value={dotLayout}
            onChange={(value) => setDotLayout(value as MastheadDotLayout)}
            options={[
              { id: "cluster", label: "Cluster" },
              { id: "facets", label: "Facets" },
              { id: "rail", label: "Rail" },
            ]}
          />
        </>
      )}
      treatments={[
        {
          id: "current",
          label: "Current · source faithful",
          note: "The control, not a proposal. PROJECT makes projects the structure and agents the leaves; RECENT makes agents the rows and project context secondary. The same state drives both frames below. At iPad width the Swift surface currently adds space but no new hierarchy, which makes the category ambiguity easier—not harder—to see.",
          body: <AgentsSurface sort={sort} onSort={setSort} />,
          wide: <AgentsSurface sort={sort} onSort={setSort} />,
          mods: { density: "compact" },
        },
        {
          id: "unified-wire",
          label: "Unified · wire hex",
          note: "Recommended synthesis. Host is global view scope, so it leaves the Agents body and joins the Scout identity in shared chrome: canonical wire-hex mark + ‘4 hosts’ or the selected host name, with no plate, pill, border, or second row. Tap the lockup for the explicit host menu. ALL is the full project/agent inventory; CHANGED is Observe, filtering the same rows. The component stays consistent across pages while each surface supplies truthful scope: fleet filter here, focused host on Terminal, run target on New.",
          body: unified(),
          wide: unified(),
          mastheadQualifier: qualifier("wire"),
          wideMastheadQualifier: qualifier("wire", true),
          mods: { density: "compact" },
        },
        {
          id: "unified-quiet",
          label: "Unified · quiet hex lab",
          note: "Preferred direction, now exercised across one to four hosts. Every known host owns one dot inside the quiet Scout hex: filled means included in this view, hollow means excluded, and muted color carries the secondary online state. The picker stays open while you choose any non-empty subset, and the project/agent rows filter from that same selection. Use DOT LAYOUT to compare cluster, facet, and rail arrangements; with one host the label collapses to its real name.",
          body: unified(),
          wide: unified(),
          mastheadQualifier: qualifier("quiet"),
          wideMastheadQualifier: qualifier("quiet", true),
          mods: { density: "compact" },
        },
      ]}
    />
  );
}
