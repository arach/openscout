/// <reference types="@mariozechner/pi-coding-agent" />

import { brokerClient } from "./broker/client.ts";
import { scoutSendTool } from "./tools/send.ts";
import { scoutAskTool } from "./tools/ask.ts";
import { scoutWhoTool } from "./tools/who.ts";
import { AgentPickerOverlay } from "./ui/agent-picker.ts";
import { ComposeOverlay } from "./ui/compose.ts";
import { InlineScoutMessage } from "./ui/inline-message.ts";
import { loadConfig } from "./config.ts";
import type { AgentInfo, PickerResult } from "./types.ts";

export default {
  name: "pi-scout",
  version: "0.1.0",

  register(ctx: PiExtContext) {
    // ─── Tools ──────────────────────────────────────────────────────────────
    ctx.registerTool(scoutSendTool);
    ctx.registerTool(scoutAskTool);
    ctx.registerTool(scoutWhoTool);

    // ─── Commands ───────────────────────────────────────────────────────────
    ctx.registerCommand({
      name: "scout",
      description: "Scout coordination: send, ask, who",
      async handler(args, ctx) {
        const [subcommand, ...rest] = args.trim().split(/\s+/);
        const restStr = rest.join(" ");

        if (subcommand === "who") {
          return ctx.tools.execute("scout_who", {}, ctx);
        }

        if (subcommand === "send") {
          return handleSendAsk("send", restStr, ctx);
        }

        if (subcommand === "ask") {
          return handleSendAsk("ask", restStr, ctx);
        }

        return handleSendAsk("send", args, ctx);
      },
    });

    // ─── SSE subscription ──────────────────────────────────────────────────
    let sseCancel: (() => void) | null = null;

    try {
      sseCancel = brokerClient.subscribeToEvents(
        (event) => {
          ctx.ui.custom((tui, theme, _kb, done) => {
            const component = new InlineScoutMessage(theme, event);
            tui.push(component);
            tui.invalidate();
            setTimeout(() => {
              tui.pop(component);
              tui.invalidate();
              done();
            }, 5000);
          });
        },
        (err) => {
          ctx.notifications.warning(`Scout SSE disconnected: ${err}`);
        },
      );
    } catch {
      // Broker may not be running — extension stays quiet
    }

    // ─── Session registration ───────────────────────────────────────────────
    ctx.on("session_start", async (_event, sessionCtx) => {
      const config = loadConfig();
      if (!config.autoRegister) return;

      try {
        const sessionFile = sessionCtx.sessionManager.getSessionFile();
        const cwd = sessionCtx.cwd;
        const displayName = "pi";
        const handle = sessionFile ? `pi.${sessionFile}` : "pi";

        await brokerClient.upsertAgentCard({
          id: `pi-scout-${handle}`,
          agentId: handle,
          displayName,
          handle,
          harness: "pi",
          transport: "local_socket",
          projectRoot: cwd,
          currentDirectory: cwd,
          nodeId: "local",
          sessionId: sessionFile ?? String(Date.now()),
        });
      } catch {
        // Silently skip if broker unavailable
      }
    });
  },
};

async function handleSendAsk(
  mode: "send" | "ask",
  restStr: string,
  ctx: PiExtContext,
) {
  const snapshot = await brokerClient.getSnapshot();

  const agents: AgentInfo[] = Object.entries(snapshot.agents).map(
    ([id, agent]) => {
      const eps = Object.values(snapshot.endpoints).filter((e) => e.agentId === id);
      return {
        id,
        label: agent.selector ?? id,
        state: eps[0]?.state ?? "offline",
        harness: eps[0]?.harness,
        nodeId: agent.authorityNodeId,
      };
    },
  );

  const result = await ctx.ui.custom((tui, theme, kb, done) => {
    const picker = new AgentPickerOverlay(theme, kb, agents, (r: PickerResult) => {
      done();
      return r;
    });
    tui.push(picker);
    tui.invalidate();
  });

  if (!result?.selected) {
    return { content: [{ type: "text", text: "Cancelled." }] };
  }

  const target = result.selected.label ?? result.selected.id;

  const composeResult = await ctx.ui.custom((tui, theme, kb, done) => {
    const compose = new ComposeOverlay(theme, kb, target, done);
    tui.push(compose);
    tui.invalidate();
  });

  if (!composeResult?.confirmed || composeResult.cancelled) {
    return { content: [{ type: "text", text: "Cancelled." }] };
  }

  if (mode === "send") {
    return ctx.tools.execute("scout_send", { target, body: composeResult.body }, ctx);
  } else {
    return ctx.tools.execute("scout_ask", { target, body: composeResult.body }, ctx);
  }
}
