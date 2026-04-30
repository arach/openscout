import type { Component } from "@mariozechner/pi-tui";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { KeybindingsManager, Theme } from "@mariozechner/pi-coding-agent";
import type { ComposeResult } from "../types.ts";

export class ComposeOverlay implements Component {
  private theme: Theme;
  private keybindings: KeybindingsManager;
  private toLabel: string;
  private body = "";
  private cursorPos = 0;
  private done: (result: ComposeResult) => void;
  private mode: "compose" | "confirm" = "compose";

  constructor(
    theme: Theme,
    keybindings: KeybindingsManager,
    toLabel: string,
    done: (result: ComposeResult) => void,
  ) {
    this.theme = theme;
    this.keybindings = keybindings;
    this.toLabel = toLabel;
    this.done = done;
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (this.mode === "confirm") {
      if (this.keybindings.matches(data, "tui.select.confirm")) {
        this.done({ body: this.body, confirmed: true, cancelled: false });
        return;
      }
      if (
        this.keybindings.matches(data, "tui.select.cancel")
        || data === "Escape"
      ) {
        this.done({ body: this.body, confirmed: false, cancelled: true });
        return;
      }
      return;
    }

    if (this.keybindings.matches(data, "tui.select.cancel")) {
      this.done({ body: this.body, confirmed: false, cancelled: true });
      return;
    }

    if (this.keybindings.matches(data, "tui.select.confirm")) {
      if (!this.body.trim()) return;
      this.mode = "confirm";
      return;
    }

    if (data === "Backspace" || data === "key:Backspace") {
      if (this.cursorPos > 0) {
        this.body =
          this.body.slice(0, this.cursorPos - 1)
          + this.body.slice(this.cursorPos);
        this.cursorPos -= 1;
      }
      return;
    }

    if (data === "key:ArrowLeft") {
      this.cursorPos = Math.max(0, this.cursorPos - 1);
      return;
    }

    if (data === "key:ArrowRight") {
      this.cursorPos = Math.min(this.body.length, this.cursorPos + 1);
      return;
    }

    if (data === "key:Home") {
      this.cursorPos = 0;
      return;
    }

    if (data === "key:End") {
      this.cursorPos = this.body.length;
      return;
    }

    // Printable characters
    const char = data;
    if (visibleWidth(char) === 1 && !data.startsWith("key:")) {
      this.body =
        this.body.slice(0, this.cursorPos) + char
        + this.body.slice(this.cursorPos);
      this.cursorPos += char.length;
    }
  }

  render(width: number): string[] {
    const innerWidth = Math.max(36, Math.min(width - 2, 88));
    const contentWidth = Math.max(1, innerWidth - 2);
    const border = (text: string) => this.theme.fg("accent", text);
    const row = (text = "") => {
      const clipped = truncateToWidth(text, contentWidth, "", true);
      return `${border("│")}${clipped}${" ".repeat(Math.max(0, contentWidth - visibleWidth(clipped)))}${border("│")}`;
    };

    const lines: string[] = [];
    lines.push(border(`╭${"─".repeat(contentWidth)}╮`));
    lines.push(row(this.theme.bold(` Scout → ${this.toLabel}`)));
    lines.push(border(`├${"─".repeat(contentWidth)}┤`));

    if (this.mode === "confirm") {
      lines.push(row());
      lines.push(row(`  ${this.theme.fg("warning", "Confirm send?")}`));
      lines.push(row());
      const preview = truncateToWidth(
        this.body || "(empty)",
        contentWidth - 4,
        "",
      );
      lines.push(row(`  ${preview}`));
      lines.push(row());
      lines.push(border(`├${"─".repeat(contentWidth)}┤`));
      lines.push(
        row(
          ` ${this.theme.fg("success", `${this.keybindings.getKeys("tui.select.confirm").join("/")}: Send`)} • ${this.keybindings.getKeys("tui.select.cancel").join("/")}: Cancel`,
        ),
      );
      lines.push(border(`╰${"─".repeat(contentWidth)}╯`));
      return lines;
    }

    lines.push(row());

    // Body input area
    const prompt = "Body: ";
    const promptWidth = visibleWidth(prompt);
    const inputAreaWidth = contentWidth - promptWidth - 1;

    const before = truncateToWidth(
      this.body.slice(0, this.cursorPos),
      inputAreaWidth,
      "",
    );
    const after = truncateToWidth(
      this.body.slice(this.cursorPos),
      inputAreaWidth - visibleWidth(before),
      "",
    );

    lines.push(
      row(
        ` ${prompt}${before}${this.theme.fg("accent", "█")}${after}${" ".repeat(Math.max(0, inputAreaWidth - visibleWidth(before) - visibleWidth(after) - 1))}`,
      ),
    );

    lines.push(row());
    lines.push(border(`├${"─".repeat(contentWidth)}┤`));
    lines.push(
      row(
        ` ${this.keybindings.getKeys("tui.select.confirm").join("/")}: Send • ${this.keybindings.getKeys("tui.select.cancel").join("/")}: Close • Type: input • ←→: move cursor`,
      ),
    );
    lines.push(border(`╰${"─".repeat(contentWidth)}╯`));

    return lines;
  }
}
