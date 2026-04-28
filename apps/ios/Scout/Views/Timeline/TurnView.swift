// TurnView — Renders a single turn within the timeline.
//
// Blocks are sorted by `index` (not arrival order, not id).
// Status indicator: spinner for streaming, X for failed, stop glyph for interrupted; nothing for completed.

import SwiftUI

struct TurnView: View {
    let turn: Turn
    var session: Session? = nil

    private var isStreaming: Bool {
        turn.status == .streaming || turn.status == .started
    }

    private var sortedBlocks: [Block] {
        turn.blocks.sorted { $0.index < $1.index }
    }

    private var isUser: Bool { turn.isUserTurn == true }

    private var agentLabel: String? {
        if let id = session?.agentId, !id.isEmpty {
            return id.hasPrefix("@") ? id : "@\(id)"
        }
        return nil
    }

    private var harnessLabel: String? {
        guard let adapter = session?.adapterType.trimmedNonEmpty else { return nil }
        return AdapterIcon.displayName(for: adapter)
    }

    var body: some View {
        if isUser {
            userBubble
        } else if sortedBlocks.isEmpty && isStreaming {
            // Agent is working but has no blocks yet — skip rendering a
            // separate "working" step. The composer's stop button and
            // address bar already communicate the streaming state.
            EmptyView()
        } else {
            assistantTurn
        }
    }

    private var userBubble: some View {
        HStack {
            Spacer(minLength: 60)
            Text(turn.blocks.first?.text ?? "")
                .font(ScoutTypography.body(15))
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(
                            LinearGradient(
                                colors: [ScoutColors.userBubbleStart, ScoutColors.userBubbleEnd],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                }
                .overlay {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.08), lineWidth: 0.5)
                }
                .shadow(color: Color.black.opacity(0.18), radius: 8, x: 0, y: 3)
        }
        .padding(.horizontal, ScoutSpacing.lg)
        .padding(.vertical, ScoutSpacing.sm)
    }

    private var assistantTurn: some View {
        HStack(alignment: .top, spacing: ScoutSpacing.md) {
            RoundedRectangle(cornerRadius: 1, style: .continuous)
                .fill(ScoutColors.accent.opacity(0.35))
                .frame(width: 2)
                .frame(maxHeight: .infinity)
                .padding(.vertical, 2)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 0) {
                turnHeader
                    .padding(.bottom, ScoutSpacing.sm)

                VStack(alignment: .leading, spacing: ScoutSpacing.md) {
                    ForEach(sortedBlocks) { block in
                        BlockView(sessionId: turn.sessionId, block: block)
                            .transition(.opacity.combined(with: .scale(scale: 0.98)))
                    }
                }
                .animation(.easeOut(duration: 0.2), value: sortedBlocks.map(\.id))
            }
        }
        .padding(.horizontal, ScoutSpacing.lg)
        .padding(.vertical, ScoutSpacing.md)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Turn, \(statusLabel), \(sortedBlocks.count) blocks")
    }

    // MARK: - Header

    private var turnHeader: some View {
        HStack(spacing: ScoutSpacing.md) {
            leadingStatusIcon

            if let agentLabel {
                Text(agentLabel)
                    .font(ScoutTypography.body(13, weight: .semibold))
                    .foregroundStyle(ScoutColors.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            if let harnessLabel {
                Text(harnessLabel)
                    .font(ScoutTypography.code(10, weight: .medium))
                    .foregroundStyle(ScoutColors.textMuted)
                    .lineLimit(1)
            }

            Spacer(minLength: ScoutSpacing.sm)

            Text(RelativeTime.string(fromISO: turn.startedAt))
                .font(ScoutTypography.caption(11))
                .foregroundStyle(ScoutColors.textMuted)
        }
        .frame(minHeight: 18)
    }

    // MARK: - Status Icon

    @ViewBuilder
    private var leadingStatusIcon: some View {
        switch turn.status {
        case .started, .streaming:
            ProgressView()
                .controlSize(.mini)
                .tint(ScoutColors.accent)
                .frame(width: 14, height: 14)
                .accessibilityLabel("Streaming")
        case .completed:
            EmptyView()
        case .failed:
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 12))
                .foregroundStyle(ScoutColors.statusError)
                .frame(width: 14, height: 14)
                .accessibilityLabel("Failed")
        case .stopped:
            Image(systemName: "stop.circle.fill")
                .font(.system(size: 12))
                .foregroundStyle(ScoutColors.statusStreaming)
                .frame(width: 14, height: 14)
                .accessibilityLabel("Interrupted")
        }
    }

    private var statusLabel: String {
        switch turn.status {
        case .started: "started"
        case .streaming: "streaming"
        case .completed: "completed"
        case .failed: "failed"
        case .stopped: "interrupted"
        }
    }
}

// MARK: - Preview

#Preview {
    ScrollView {
        TurnView(
            turn: Turn(
                id: "t1",
                sessionId: "s1",
                status: .completed,
                startedAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-120)),
                endedAt: ISO8601DateFormatter().string(from: Date().addingTimeInterval(-90)),
                blocks: [
                    Block(id: "b1", turnId: "t1", type: .text, status: .completed, index: 0,
                          text: "Let me help you with that refactoring."),
                    Block(id: "b2", turnId: "t1", type: .action, status: .completed, index: 1,
                          action: Action(kind: .command, status: .completed, output: "Done",
                                         command: "git diff --stat")),
                    Block(id: "b3", turnId: "t1", type: .text, status: .completed, index: 2,
                          text: "The changes look good. I've updated 3 files."),
                ]
            ),
            session: Session(
                id: "s1",
                name: "refactor sweep",
                adapterType: "claude-code",
                status: .active,
                cwd: "/tmp",
                providerMeta: ["agentId": AnyCodable("scout-pilot")]
            )
        )
    }
    .background(Color(white: 0.07))
    .preferredColorScheme(.dark)
}
