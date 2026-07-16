import { useEffect, useState } from "react";
import { AgentAvatar } from "../../components/AgentAvatar.tsx";
import { HarnessMark } from "../../components/HarnessMark.tsx";
import { agentStateLabel } from "../../lib/agent-state.ts";
import { timeAgo } from "../../lib/time.ts";
import type { LocalAgentConfigState, Route } from "../../lib/types.ts";
import { AgentEssentialsGlyph } from "../agents/agent-essentials.tsx";
import {
  agentNodeLabel,
  harnessOf,
  openProjectAgentConfig,
  openProjectAgentProfile,
  registryAgentSubline,
} from "./model.ts";
import { agentSpecialization, partitionProjectRoster } from "./agent-specialization.ts";
import {
  defaultAgentOverviewRow,
  permissionLabel,
  sessionLinesForRow,
  shortHomePath,
  type AgentOverviewRow,
} from "./project-overview-helpers.ts";

type Navigate = (route: Route) => void;

function FactCell({ label, value, title }: { label: string; value: string | null | undefined; title?: string }) {
  if (!value?.trim()) return null;
  return (
    <div className="av2-agentFact">
      <dt>{label}</dt>
      <dd title={title ?? value}>{value}</dd>
    </div>
  );
}

function AgentListItem({
  row,
  selected,
  onSelect,
}: {
  row: AgentOverviewRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const { entry, tone, workLine, handle } = row;
  const spec = agentSpecialization(entry.leadAgent, row.config);
  return (
    <button
      type="button"
      className="av2-agentListItem"
      data-selected={selected || undefined}
      data-tone={tone === "idle" ? undefined : tone}
      data-specialist={!spec.isGeneralist || undefined}
      onClick={onSelect}
    >
      <span className="av2-dot" data-tone={tone === "idle" ? undefined : tone} aria-hidden />
      <span className="av2-agentListCopy">
        <span className="av2-agentListTitleRow">
          <span className="av2-agentListName">@{handle}</span>
          <span
            className="av2-agentSpecKind"
            data-generalist={spec.isGeneralist || undefined}
            title={spec.role ? `${spec.kind} · ${spec.role}` : spec.kind}
          >
            {spec.headline}
          </span>
        </span>
        <span className="av2-agentListWork" title={workLine}>
          {workLine}
        </span>
        <span className="av2-agentListMeta">
          {registryAgentSubline(entry)}
          {entry.group.sessionCount > 0 ? ` · ${entry.group.sessionCount} sess` : ""}
          {entry.group.lastActivityAt ? ` · ${timeAgo(entry.group.lastActivityAt)}` : ""}
        </span>
      </span>
      {entry.leadAgent.harness ? (
        <span className="av2-agentListMark" aria-hidden>
          <HarnessMark harness={harnessOf(entry.leadAgent.harness)} size={10} />
        </span>
      ) : null}
    </button>
  );
}

function AgentDetailPane({
  row,
  route,
  navigate,
}: {
  row: AgentOverviewRow;
  route: Extract<Route, { view: "agents-v2" }>;
  navigate: Navigate;
}) {
  const { entry, config, projectRoot, workLine, tone } = row;
  const agent = entry.leadAgent;
  const prompt =
    config?.systemPrompt?.trim()
    || config?.templateHint
    || "default template";
  const sessionLines = sessionLinesForRow(row);
  const multiInstance = entry.group.nodes.length > 1;
  const spec = agentSpecialization(agent, config);

  const selectAgent = () =>
    navigate({
      ...route,
      selectedAgentId: row.agentId,
      agentId: undefined,
      sessionId: undefined,
    });

  const openSession = (sessionId: string) =>
    navigate({
      ...route,
      sessionId,
      selectedAgentId: undefined,
      agentId: undefined,
    });

  return (
    <>
      <header className="av2-agentDetailHead">
        <AgentAvatar agent={agent} size={40} tile presence={false} />
        <div className="av2-agentDetailIdent">
          <div className="av2-agentDetailTitleRow">
            <span className="av2-agentDetailName">{agent.name?.trim() || row.handle}</span>
            <span className="av2-agentDetailHandle">@{row.handle}</span>
            <span
              className="av2-agentSpecKind av2-agentSpecKind--detail"
              data-generalist={spec.isGeneralist || undefined}
            >
              {spec.headline}
            </span>
          </div>
          <span className="av2-agentDetailStatus">
            <span className="av2-dot" data-tone={tone === "idle" ? undefined : tone} aria-hidden />
            {agentStateLabel(agent.state, agent)}
            {entry.leadRow.activeAskCount > 0 ? ` · ${entry.leadRow.activeAskCount} asks` : ""}
            {entry.group.sessionCount > 0
              ? ` · ${entry.group.sessionCount} session${entry.group.sessionCount === 1 ? "" : "s"}`
              : ""}
            {entry.group.lastActivityAt ? ` · ${timeAgo(entry.group.lastActivityAt)}` : ""}
          </span>
        </div>
        <div className="av2-agentDetailActs">
          <button type="button" className="av2-embedLaunch" data-primary onClick={selectAgent}>
            peek
          </button>
          <button
            type="button"
            className="av2-embedLaunch"
            onClick={() => navigate(openProjectAgentConfig(route, row.agentId))}
          >
            config
          </button>
          <button
            type="button"
            className="av2-embedLaunch"
            onClick={() => navigate(openProjectAgentProfile(route, row.agentId))}
          >
            profile ↗
          </button>
        </div>
      </header>

      <div className="av2-agentDetailScroll">
        <section className="av2-agentDetailSec">
          <div className="av2-agentDetailSecHead">Right now</div>
          <p className="av2-agentDetailNow" title={workLine}>
            {workLine}
          </p>
        </section>

        <AgentEssentialsGlyph agent={agent} projectRoot={projectRoot} className="av2-agentDetailGlyph" />

        <section className="av2-agentDetailSec">
          <div className="av2-agentDetailSecHead">Specialization</div>
          <dl className="av2-agentFacts">
            <FactCell label="class" value={spec.kind} />
            <FactCell label="role" value={spec.role} />
          </dl>
          {spec.skills.length > 0 ? (
            <div className="av2-agentSpecBlock">
              <span className="av2-agentSpecBlockLabel">Context & skills</span>
              <div className="av2-agentSpecChips" aria-label="Skills">
                {spec.skills.map((skill) => (
                  <span key={skill} className="av2-agentSpecChip" data-kind="skill">
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          ) : spec.isGeneralist ? (
            <p className="av2-agentSpecNote">
              Generalist — broad project context. Add class, role, or skills when you promote a specialist.
            </p>
          ) : null}
          {spec.capabilities.length > 0 ? (
            <div className="av2-agentSpecChips" aria-label="Capabilities">
              {spec.capabilities.map((cap) => (
                <span key={cap} className="av2-agentSpecChip" data-kind="capability">
                  {cap}
                </span>
              ))}
            </div>
          ) : null}
        </section>

        <section className="av2-agentDetailSec">
          <div className="av2-agentDetailSecHead">Identity</div>
          <dl className="av2-agentFacts">
            <FactCell label="id" value={agent.id} />
            <FactCell label="harness" value={agent.harness ?? config?.runtime.harness ?? null} />
            <FactCell label="model" value={agent.model ?? config?.model ?? null} />
            <FactCell label="transport" value={agent.transport ?? config?.runtime.transport ?? null} />
            <FactCell label="node" value={agentNodeLabel(agent)} />
            <FactCell label="wake" value={agent.wakePolicy ?? config?.runtime.wakePolicy ?? null} />
          </dl>
        </section>

        <section className="av2-agentDetailSec">
          <div className="av2-agentDetailSecHead">Placement</div>
          <dl className="av2-agentFacts">
            <FactCell
              label="cwd"
              value={shortHomePath(config?.runtime.cwd ?? agent.cwd ?? projectRoot)}
              title={config?.runtime.cwd ?? agent.cwd ?? projectRoot ?? undefined}
            />
            <FactCell label="branch" value={agent.branch ?? entry.group.branches[0] ?? null} />
            <FactCell
              label="root"
              value={shortHomePath(projectRoot ?? agent.projectRoot)}
              title={projectRoot ?? agent.projectRoot ?? undefined}
            />
            <FactCell label="session ref" value={config?.runtime.sessionId || agent.harnessSessionId} />
            {agent.conversationId ? <FactCell label="chat" value={agent.conversationId} /> : null}
          </dl>
        </section>

        {config ? (
          <section className="av2-agentDetailSec">
            <div className="av2-agentDetailSecHead">Prompt</div>
            <pre className="av2-agentDetailPrompt" title={config.systemPrompt}>
              {prompt}
            </pre>
          </section>
        ) : null}

        {config ? (
          <section className="av2-agentDetailSec">
            <div className="av2-agentDetailSecHead">Runtime config</div>
            <dl className="av2-agentFacts">
              <FactCell label="permissions" value={permissionLabel(config.permissionProfile)} />
              <FactCell label="apply" value={config.applyMode} />
              <FactCell
                label="launch"
                value={config.launchArgs.length > 0 ? config.launchArgs.join(" ") : "—"}
                title={config.launchArgs.join(" ") || undefined}
              />
            </dl>
          </section>
        ) : (
          <section className="av2-agentDetailSec">
            <div className="av2-agentDetailSecHead">Local config</div>
            <span className="av2-embedEmpty">No local agent config on disk.</span>
          </section>
        )}

        {multiInstance ? (
          <section className="av2-agentDetailSec">
            <div className="av2-agentDetailSecHead">
              Instances · {entry.group.nodes.length}
            </div>
            <div className="av2-agentInstances">
              {entry.group.nodes.map((node) => (
                <div key={node.row.agent.id} className="av2-agentInstance">
                  <span className="av2-agentInstanceBranch">{node.row.branch || "—"}</span>
                  <span className="av2-agentInstanceCwd" title={node.row.agent.cwd ?? undefined}>
                    {shortHomePath(node.row.agent.cwd)}
                  </span>
                  <span className="av2-agentInstanceState">{node.row.stateLabel}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {sessionLines.length > 0 ? (
          <section className="av2-agentDetailSec">
            <div className="av2-agentDetailSecHead">
              Sessions · {row.sessions.length}
            </div>
            <div className="av2-agentSessions">
              {sessionLines.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  className="av2-agentSessionItem"
                  onClick={() => openSession(session.id)}
                >
                  <span className="av2-agentSessionPreview" title={session.preview}>
                    {session.preview}
                  </span>
                  <span className="av2-agentSessionWhen">
                    {session.when ? timeAgo(session.when) : "—"}
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </>
  );
}

export function ProjectAgentsFrame({
  rows,
  route,
  navigate,
}: {
  rows: AgentOverviewRow[];
  route: Extract<Route, { view: "agents-v2" }>;
  navigate: Navigate;
}) {
  const roster = partitionProjectRoster(rows);

  const [selectedId, setSelectedId] = useState<string | null>(() => defaultAgentOverviewRow(rows)?.agentId ?? null);
  const selected = rows.find((row) => row.agentId === selectedId) ?? defaultAgentOverviewRow(rows);

  useEffect(() => {
    setSelectedId((current) => {
      if (current && rows.some((row) => row.agentId === current)) return current;
      return defaultAgentOverviewRow(rows)?.agentId ?? null;
    });
  }, [rows]);

  if (rows.length === 0) {
    return <span className="av2-facetEmpty">No agents registered for this project.</span>;
  }

  return (
    <div className="av2-agentsFrame">
      <aside className="av2-agentList" aria-label="Project agents">
        <div className="av2-agentListHead">
          <span className="av2-agentListHeadLabel">Agents</span>
          <span className="av2-agentListHeadCount">{rows.length}</span>
        </div>
        <div className="av2-agentListBody">
          {roster.hangout.length > 0 ? (
            <>
              <div className="av2-agentListGroup" data-kind="hangout">
                Hang out · {roster.hangout.length}
              </div>
              {roster.hangout.map((row) => (
                <AgentListItem
                  key={row.agentId}
                  row={row}
                  selected={selected?.agentId === row.agentId}
                  onSelect={() => setSelectedId(row.agentId)}
                />
              ))}
            </>
          ) : null}
          {roster.experts.length > 0 ? (
            <>
              <div className="av2-agentListGroup" data-kind="experts">
                Experts · {roster.experts.length}
              </div>
              {roster.experts.map((row) => (
                <AgentListItem
                  key={row.agentId}
                  row={row}
                  selected={selected?.agentId === row.agentId}
                  onSelect={() => setSelectedId(row.agentId)}
                />
              ))}
            </>
          ) : null}
        </div>
      </aside>
      <section className="av2-agentDetail" aria-label="Agent detail">
        {selected ? (
          <AgentDetailPane row={selected} route={route} navigate={navigate} />
        ) : (
          <div className="av2-repoViewerState">Select an agent to inspect.</div>
        )}
      </section>
    </div>
  );
}
