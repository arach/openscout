import type { Component } from "@mariozechner/pi-tui";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { KeybindingsManager, Theme } from "@mariozechner/pi-coding-agent";
import type { AgentInfo, PickerResult } from "../types.ts";

export class AgentPickerOverlay implements Component {
  private theme: Theme;
  private keybindings: KeybindingsManager;
  private agents: AgentInfo[];
  private selectedIndex = 0;
  private query = "";
  private done: (result: PickerResult) => void;
  private maxVisible = 10;

  constructor(
    theme: Theme,
    keybindings: KeybindingsManager,
    agents: AgentInfo[],
    done: (result: PickerResult) => void,
  ) {
    this.theme = theme;
    this.keybindings = keybindings;
    this.agents = agents;
    this.done = done;
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (this.keybindings.matches(data, "tui.select.cancel")) {
      this.done({ selected: null, cancelled: true });
      return;
    }
    const filtered = this.filteredAgents();

    if (this.keybindings.matches(data, "tui.select.up")) {
      if (filtered.length === 0) return;
      this.selectedIndex =
        this.selectedIndex <= 0
          ? filtered.length - 1
          : this.selectedIndex - 1;
      return;
    }

    if (this.keybindings.matches(data, "tui.select.down")) {
      if (filtered.length === 0) return;
      this.selectedIndex =
        this.selectedIndex >= filtered.length - 1
          ? 0
          : this.selectedIndex + 1;
      return;
    }

    if (this.keybindings.matches(data, "tui.select.confirm")) {
      const agent = filtered[this.selectedIndex];
      if (agent) {
        this.done({ selected: agent, cancelled: false });
      }
      return;
    }

    // Typeable input for fuzzy filter
    const char = data;
    if (visibleWidth(char) === 1 && !data.startsWith("key:")) {
      this.query += char;
      this.selectedIndex = 0;
    } else if (data === "Backspace" || data === "key:Backspace") {
      this.query = this.query.slice(0, -1);
      this.selectedIndex = 0;
    }
  }

  private filteredAgents(): AgentInfo[] {
    if (!this.query.trim()) return this.agents;
    const q = this.query.toLowerCase();
    return this.agents.filter(
      (a) =>
        a.label.toLowerCase().includes(q)
        || a.id.toLowerCase().includes(q)
        || (a.harness ?? "").toLowerCase().includes(q),
    );
  }

  render(width: number): string[] {
    const filtered = this.filteredAgents();
    const innerWidth = Math.max(36, Math.min(width - 2, 88));
    const contentWidth = Math.max(1, innerWidth - 2);
    const border = (text: string) => this.theme.fg("accent", text);
    const row = (text = "") => {
      const clipped = truncateToWidth(text, contentWidth, "", true);
      return `${border("│")}${clipped}${" ".repeat(Math.max(0, contentWidth - visibleWidth(clipped)))}${border("│")}`;
    };

    const footer = [
      `${this.keybindings.getKeys("tui.select.confirm").join("/")}: Select`,
      `${this.keybindings.getKeys("tui.select.cancel").join("/")}: Close`,
      "Type: filter",
    ].join(" • ");

    const lines: string[] = [];
    lines.push(border(`╭${"─".repeat(contentWidth)}╮`));
    lines.push(row(this.theme.bold(" Scout Agents")));
    lines.push(border(`├${"─".repeat(contentWidth)}┤`));
    lines.push(row());

    if (this.query) {
      lines.push(
        row(
          ` ${this.theme.fg("dim", `Filter: "${this.query}" → ${filtered.length} match${filtered.length !== 1 ? "es" : ""}`)}`,
        ),
      );
      lines.push(row());
    }

    if (filtered.length === 0) {
      lines.push(row(this.theme.fg("dim", "  No agents match")));
    } else {
      const startIndex = Math.max(
        0,
        Math.min(
          this.selectedIndex - Math.floor(this.maxVisible / 2),
          filtered.length - this.maxVisible,
        ),
      );
      const endIndex = Math.min(
        startIndex + this.maxVisible,
        filtered.length,
      );

      for (let index = startIndex; index < endIndex; index += 1) {
        const agent = filtered[index];
        const isSelected = index === this.selectedIndex;
        const prefix = isSelected
          ? this.theme.fg("accent", "→ ")
          : "  ";
        const label = truncateToWidth(agent.label, Math.max(8, contentWidth - 2), "");
        const stateColor =
          agent.state === "active"
            ? this.theme.fg("success", agent.state)
            : this.theme.fg("dim", agent.state);
        const info = [
          agent.harness ? `· ${agent.harness}` : "",
          `· ${agent.state}`,
        ]
          .filter(Boolean)
          .join(" ");

        lines.push(row(`${prefix}${label}`));
        lines.push(
          row(`  ${this.theme.fg("dim", truncateToWidth(agent.id, contentWidth - 4, ""))}`),
        );
        lines.push(
          row(
            `  ${this.theme.fg("dim", stateColor)} ${this.theme.fg("dim", info)}`,
          ),
        );
        if (index < endIndex - 1) lines.push(row());
      }

      if (
        startIndex > 0 ||
        endIndex < filtered.length
      ) {
        lines.push(row());
        lines.push(
          row(
            this.theme.fg(
              "dim",
              ` ${this.selectedIndex + 1}/${filtered.length} agents`,
            ),
          ),
        );
      }
    }

    lines.push(row());
    lines.push(border(`├${"─".repeat(contentWidth)}┤`));
    lines.push(row(this.theme.fg("dim", ` ${footer}`)));
    lines.push(border(`╰${"─".repeat(contentWidth)}╯`));

    return lines;
  }
}
