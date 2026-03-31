// ErrorBlockView — Red-tinted error card with monospace message.

import SwiftUI

struct ErrorBlockView: View {
    let block: Block

    private var errorMessage: String {
        block.message ?? "An unknown error occurred"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: PlexusSpacing.sm) {
            HStack(spacing: PlexusSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(PlexusColors.statusError)

                Text("Error")
                    .font(PlexusTypography.body(14, weight: .semibold))
                    .foregroundStyle(PlexusColors.statusError)

                Spacer()

                if let code = block.code {
                    Text(code)
                        .font(PlexusTypography.codeCaption)
                        .foregroundStyle(PlexusColors.statusError.opacity(0.7))
                        .padding(.horizontal, PlexusSpacing.sm)
                        .padding(.vertical, PlexusSpacing.xxs)
                        .background(PlexusColors.statusError.opacity(0.1))
                        .clipShape(Capsule())
                }
            }

            Text(errorMessage)
                .font(PlexusTypography.codeBody)
                .foregroundStyle(PlexusColors.textPrimary)
                .textSelection(.enabled)
                .lineSpacing(2)
        }
        .padding(PlexusSpacing.md)
        .background(PlexusColors.errorBackground)
        .clipShape(RoundedRectangle(cornerRadius: PlexusRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: PlexusRadius.md, style: .continuous)
                .strokeBorder(PlexusColors.statusError.opacity(0.25), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Error: \(errorMessage)")
    }
}

// MARK: - Preview

#Preview {
    VStack(spacing: 16) {
        ErrorBlockView(block: Block(
            id: "1", turnId: "t1", type: .error, status: .completed, index: 0,
            message: "Permission denied: Cannot write to /etc/hosts", code: "EACCES"
        ))

        ErrorBlockView(block: Block(
            id: "2", turnId: "t1", type: .error, status: .completed, index: 1,
            message: "Connection timed out after 30000ms"
        ))
    }
    .padding()
    .background(Color(white: 0.07))
    .preferredColorScheme(.dark)
}
