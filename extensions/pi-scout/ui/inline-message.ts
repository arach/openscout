import type { Component } from "@mariozechner/pi-tui";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { Theme } from "@mariozechner/pi-coding-agent";
import type { ScoutEvent } from "../types.ts";

export class InlineScoutMessage implements Component {
  private theme: Theme;
  private event: ScoutEvent;
  private age = 0;

  constructor(theme: Theme, event: ScoutEvent) {
    this.theme = theme;
    this.event = event;
  }

  invalidate(): void {}
  handleInput(): void {}

  render(width: number): string[] {
    const contentWidth = Math.max(1, width - 2);

    const sender =
      (this.event as Record<string, unknown>).senderLabel
      ?? (this.event as Record<string, unknown>).sender
      ?? "unknown";
    const body =
      (this.event as Record<string, unknown>).body
      ?? (this.event as Record<string, unknown>).message
      ?? "";
    const ageStr = this.age > 0 ? ` · ${this.age}s ago` : "";

    const lines: string[] = [];
    const border = (text: string) => this.theme.fg("accent", text);
    const labelWidth = visibleWidth(`Scout Message from ${sender}${ageStr}`);

    lines.push(
      border(
        `┌─ ${this.theme.bold("Scout Message from")} ${this.theme.fg("success", sender)}${ageStr}${"─".repeat(Math.max(0, contentWidth - labelWidth - 4))}┐`,
      ),
    );

    const bodyLines = String(body).split("\n").slice(0, 6);
    for (const line of bodyLines) {
      const truncated = truncateToWidth(line, contentWidth - 4, "");
      lines.push(
        `${border("│")}  ${truncated}${" ".repeat(Math.max(0, contentWidth - visibleWidth(truncated) - 4))}${border("│")}`,
      );
    }

    if (String(body).split("\n").length > 6) {
      lines.push(
        `${border("│")}  ${this.theme.fg("dim", "…")}${" ".repeat(Math.max(0, contentWidth - 5))}${border("│")}`,
      );
    }

    lines.push(border(`└${"─".repeat(contentWidth)}┘`));

    return lines;
  }
}
