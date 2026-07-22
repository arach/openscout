import ScoutAppCore
import SwiftUI

// Scoutbot tab (5) — work-first fleet command console.
//
// `scout` (tab 4) stays the conversational DM-to-Scout surface.
// `scoutbot` is the command console: runnable chips for the work-first
// slash commands plus an input, wired to the SAME ScoutComposeService
// pipeline the assistant/scout surface already uses. Slash commands
// typed to Scout route through packages/web/server/scoutbot/prefilter.ts
// and land as real replies on `assistantThread` (e.g. /status → ON YOU /
// RECENT work-first output).
//
// Input is the universal MessageComposer dock (one composer, studio shape).
// Chips run immediately through ScoutComposeService; freeform slash
// commands type into the dock the same way as every other tab.
//
// Deferred (not fake affordances — just not built yet):
//   · Dedicated scoutbot transcript stream (shares assistantThread with
//     tab 4 so DM + command replies stay one conversation for now)
//   · Structured status-line widgets (replies render as mono text blocks;
//     prefilter already shapes the body)

struct HUDScoutbotView: View {
    @ObservedObject private var compose = ScoutComposeService.shared
    @ObservedObject private var state = HUDState.shared
    @State private var isSending = false

    private static let commands: [(cmd: String, hint: String)] = [
        ("/status", "ON YOU, then RECENT work"),
        ("/recent", "Recent work (fleet)"),
        ("/agents", "Hands as facets of work"),
        ("/help", "Commands + addressing"),
    ]

    var body: some View {
        VStack(spacing: 0) {
            header
            ScrollViewReader { proxy in
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 0) {
                        commandPalette
                        if compose.assistantThread.isEmpty {
                            emptyHint
                        } else {
                            consoleLog
                        }
                    }
                    .padding(.bottom, 12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .onChange(of: compose.assistantThread.count) { _, _ in
                    guard let last = compose.assistantThread.last else { return }
                    withAnimation(.easeOut(duration: 0.16)) {
                        proxy.scrollTo(last.id, anchor: .bottom)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }

    // MARK: - Header

    private var header: some View {
        HStack(spacing: 8) {
            RobotGlyphShape()
                .stroke(HUDChrome.accent, style: StrokeStyle(lineWidth: 1, lineCap: .round, lineJoin: .round))
                .frame(width: 12, height: 12)
            Text("SCOUTBOT")
                .font(HUDType.mono(10, weight: .bold))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(HUDChrome.accent)
            Text("·")
                .font(HUDType.mono(10))
                .foregroundStyle(HUDChrome.inkFaint)
            Text("COMMAND CONSOLE")
                .font(HUDType.mono(10, weight: .semibold))
                .tracking(HUDType.eyebrowTracking)
                .foregroundStyle(HUDChrome.inkFaint)
            Spacer(minLength: 0)
            if isSending || compose.isSending {
                Text("…")
                    .font(HUDType.mono(11, weight: .semibold))
                    .foregroundStyle(HUDChrome.accent)
            }
        }
        .padding(.horizontal, horizontalPad)
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(HUDChrome.border)
                .frame(height: 0.5)
        }
    }

    // MARK: - Command chips

    private var commandPalette: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("RUN")
                .font(HUDType.mono(9, weight: .semibold))
                .tracking(HUDType.eyebrowMicro)
                .foregroundStyle(HUDChrome.inkFaint)

            // Flow-style wrap without LazyVGrid: two rows of two chips
            // keep density compact on S tier and stay tappable.
            LazyVGrid(
                columns: [
                    GridItem(.flexible(), spacing: 8),
                    GridItem(.flexible(), spacing: 8),
                ],
                spacing: 8
            ) {
                ForEach(Self.commands, id: \.cmd) { item in
                    CommandChip(
                        cmd: item.cmd,
                        hint: item.hint,
                        disabled: isSending || compose.isSending
                    ) {
                        runCommand(item.cmd)
                    }
                }
            }
        }
        .padding(.horizontal, horizontalPad)
        .padding(.top, 12)
        .padding(.bottom, 10)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(HUDChrome.border)
                .frame(height: 0.5)
        }
    }

    private var emptyHint: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Run a command chip, or type a slash command in the dock.")
                .font(HUDType.body(12))
                .foregroundStyle(HUDChrome.inkMuted)
            Text("Replies use the live scoutbot prefilter (/status → ON YOU · RECENT).")
                .font(HUDType.mono(10))
                .foregroundStyle(HUDChrome.inkFaint)
        }
        .padding(.horizontal, horizontalPad)
        .padding(.top, 16)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Console log (shared assistantThread)

    private var consoleLog: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(compose.assistantThread) { message in
                ConsoleMessageRow(message: message)
                    .id(message.id)
            }
            if compose.assistantThread.last?.source == .operatorYou {
                ConsoleThinkingRow()
            }
        }
        .padding(.horizontal, horizontalPad)
        .padding(.top, 12)
    }

    private var horizontalPad: CGFloat {
        state.size == .compact ? 16 : 20
    }

    // MARK: - Actions

    private func runCommand(_ cmd: String) {
        Task { await send(cmd) }
    }

    /// Same pipeline as the dock / assistant: default target is scoutbot,
    /// replies stream back onto `assistantThread` via SSE.
    private func send(_ body: String) async {
        isSending = true
        defer { isSending = false }
        await ScoutComposeService.shared.send(body: body, targetHandle: nil)
    }
}

// MARK: - Chips

private struct CommandChip: View {
    let cmd: String
    let hint: String
    var disabled: Bool = false
    let action: () -> Void

    @State private var hovered = false

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 2) {
                Text(cmd)
                    .font(HUDType.mono(11, weight: .semibold))
                    .foregroundStyle(HUDChrome.accent)
                Text(hint)
                    .font(HUDType.mono(9))
                    .foregroundStyle(HUDChrome.inkFaint)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(hovered ? HUDChrome.canvasLift.opacity(0.45) : HUDChrome.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(
                        hovered ? HUDChrome.accent.opacity(0.45) : HUDChrome.border,
                        lineWidth: 0.75
                    )
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.55 : 1)
        .onHover { hovered = $0 }
        .help("Run \(cmd)")
    }
}

// MARK: - Console rows

private struct ConsoleMessageRow: View {
    let message: ScoutAssistantMessage

    private var isScout: Bool { message.source == .scout }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Text(isScout ? "scoutbot" : "you")
                    .font(HUDType.mono(9, weight: .semibold))
                    .tracking(HUDType.eyebrowMicro)
                    .foregroundStyle(isScout ? HUDChrome.accent : HUDChrome.inkMuted)
                    .textCase(.uppercase)
                Text("·")
                    .font(HUDType.mono(9))
                    .foregroundStyle(HUDChrome.inkFaint)
                Text(message.at)
                    .font(HUDType.mono(9))
                    .monospacedDigit()
                    .foregroundStyle(HUDChrome.inkFaint)
                Spacer(minLength: 0)
            }

            Text(consoleBody(message.body))
                .font(HUDType.mono(11))
                .foregroundStyle(HUDChrome.ink)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
    }

    private func consoleBody(_ spans: [ScoutAssistantSpan]) -> String {
        spans.map { span in
            switch span {
            case .text(let s), .mention(let s), .cmd(let s), .path(let s), .code(let s):
                return s
            }
        }.joined()
    }
}

private struct ConsoleThinkingRow: View {
    @State private var phase = 0
    private let timer = Timer.publish(every: 0.42, on: .main, in: .common).autoconnect()

    var body: some View {
        HStack(spacing: 6) {
            Text("scoutbot")
                .font(HUDType.mono(9, weight: .semibold))
                .tracking(HUDType.eyebrowMicro)
                .foregroundStyle(HUDChrome.accent.opacity(0.7))
                .textCase(.uppercase)
            HStack(spacing: 2) {
                ForEach(0..<3, id: \.self) { i in
                    Circle()
                        .fill(HUDChrome.accent)
                        .frame(width: 3, height: 3)
                        .opacity(phase == i ? 1.0 : 0.25)
                }
            }
            Spacer(minLength: 0)
        }
        .onReceive(timer) { _ in phase = (phase + 1) % 3 }
    }
}
