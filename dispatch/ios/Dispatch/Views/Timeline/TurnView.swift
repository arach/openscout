// TurnView — Renders a single turn within the timeline.
//
// Blocks are sorted by `index` (not arrival order, not id).
// Status indicator: spinner for streaming, checkmark for completed, X for failed/interrupted.

import SwiftUI

struct TurnView: View {
    let turn: Turn

    private var isStreaming: Bool {
        turn.status == .streaming || turn.status == .started
    }

    private var sortedBlocks: [Block] {
        turn.blocks.sorted { $0.index < $1.index }
    }

    private var isUser: Bool { turn.isUserTurn == true }

    var body: some View {
        if isUser {
            userBubble
        } else {
            assistantTurn
        }
    }

    private var userBubble: some View {
        HStack {
            Spacer(minLength: 60)
            Text(turn.blocks.first?.text ?? "")
                .font(DispatchTypography.body(15))
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(DispatchColors.accent)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .padding(.horizontal, DispatchSpacing.lg)
        .padding(.vertical, DispatchSpacing.sm)
    }

    private var assistantTurn: some View {
        VStack(alignment: .leading, spacing: 0) {
            turnHeader
                .padding(.bottom, DispatchSpacing.sm)

            VStack(alignment: .leading, spacing: DispatchSpacing.md) {
                ForEach(sortedBlocks) { block in
                    BlockView(block: block)
                        .transition(.opacity.combined(with: .scale(scale: 0.98)))
                }
            }
            .animation(.easeOut(duration: 0.2), value: sortedBlocks.map(\.id))
        }
        .padding(.horizontal, DispatchSpacing.lg)
        .padding(.vertical, DispatchSpacing.md)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Turn, \(statusLabel), \(sortedBlocks.count) blocks")
    }

    // MARK: - Header

    private var turnHeader: some View {
        HStack(spacing: DispatchSpacing.sm) {
            statusIcon
                .frame(width: 18, height: 18)

            Text(RelativeTime.string(fromISO: turn.startedAt))
                .font(DispatchTypography.caption(11))
                .foregroundStyle(DispatchColors.textMuted)

            if sortedBlocks.count > 1 {
                Text("\(sortedBlocks.count) blocks")
                    .font(DispatchTypography.caption(11))
                    .foregroundStyle(DispatchColors.textMuted)
                    .padding(.horizontal, DispatchSpacing.sm)
                    .padding(.vertical, DispatchSpacing.xxs)
                    .background(DispatchColors.surfaceAdaptive)
                    .clipShape(Capsule())
            }

            Spacer()
        }
    }

    // MARK: - Status Icon

    @ViewBuilder
    private var statusIcon: some View {
        switch turn.status {
        case .started, .streaming:
            ProgressView()
                .controlSize(.mini)
                .tint(DispatchColors.accent)
                .accessibilityLabel("Streaming")
        case .completed:
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 14))
                .foregroundStyle(DispatchColors.statusActive)
                .accessibilityLabel("Completed")
        case .failed:
            Image(systemName: "xmark.circle.fill")
                .font(.system(size: 14))
                .foregroundStyle(DispatchColors.statusError)
                .accessibilityLabel("Failed")
        case .stopped:
            Image(systemName: "stop.circle.fill")
                .font(.system(size: 14))
                .foregroundStyle(DispatchColors.statusStreaming)
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
        TurnView(turn: Turn(
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
        ))
    }
    .background(Color(white: 0.07))
    .preferredColorScheme(.dark)
}
