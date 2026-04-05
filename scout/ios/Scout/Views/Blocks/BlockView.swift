// BlockView — Dispatches to the correct block view based on block type.
//
// Unknown block types render a generic "Unsupported" placeholder.
// Blocks are always rendered sorted by `index` (enforced by the parent TurnView).

import SwiftUI

struct BlockView: View {
    let block: Block

    var body: some View {
        switch block.type {
        case .text:
            TextBlockView(block: block)
        case .reasoning:
            ReasoningBlockView(block: block)
        case .action:
            ActionBlockView(block: block)
        case .file:
            FileBlockView(block: block)
        case .error:
            ErrorBlockView(block: block)
        }
    }
}

/// Fallback for any block type the client doesn't recognize.
/// This should not occur with the current protocol (5 known types),
/// but guards against future additions without a client update.
struct UnsupportedBlockView: View {
    let blockType: String

    var body: some View {
        HStack(spacing: ScoutSpacing.sm) {
            Image(systemName: "questionmark.app.dashed")
                .font(.system(size: 16))
                .foregroundStyle(ScoutColors.textMuted)

            VStack(alignment: .leading, spacing: ScoutSpacing.xxs) {
                Text("Unsupported block")
                    .font(ScoutTypography.body(14, weight: .medium))
                    .foregroundStyle(ScoutColors.textSecondary)
                Text("Type: \(blockType)")
                    .font(ScoutTypography.codeCaption)
                    .foregroundStyle(ScoutColors.textMuted)
            }

            Spacer()
        }
        .scoutCard()
        .accessibilityLabel("Unsupported block type: \(blockType)")
    }
}

// MARK: - Preview

#Preview {
    VStack(spacing: 12) {
        BlockView(block: Block(
            id: "1", turnId: "t1", type: .text, status: .completed, index: 0,
            text: "Hello **world**!"
        ))

        BlockView(block: Block(
            id: "2", turnId: "t1", type: .error, status: .completed, index: 1,
            message: "Something went wrong"
        ))

        UnsupportedBlockView(blockType: "diagram")
    }
    .padding()
    .background(Color(white: 0.07))
    .preferredColorScheme(.dark)
}
