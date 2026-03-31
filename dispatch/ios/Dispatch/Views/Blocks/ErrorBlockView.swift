// ErrorBlockView — Red-tinted error card with monospace message.

import SwiftUI

struct ErrorBlockView: View {
    let block: Block

    private var errorMessage: String {
        block.message ?? "An unknown error occurred"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DispatchSpacing.sm) {
            HStack(spacing: DispatchSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(DispatchColors.statusError)

                Text("Error")
                    .font(DispatchTypography.body(14, weight: .semibold))
                    .foregroundStyle(DispatchColors.statusError)

                Spacer()

                if let code = block.code {
                    Text(code)
                        .font(DispatchTypography.codeCaption)
                        .foregroundStyle(DispatchColors.statusError.opacity(0.7))
                        .padding(.horizontal, DispatchSpacing.sm)
                        .padding(.vertical, DispatchSpacing.xxs)
                        .background(DispatchColors.statusError.opacity(0.1))
                        .clipShape(Capsule())
                }
            }

            Text(errorMessage)
                .font(DispatchTypography.codeBody)
                .foregroundStyle(DispatchColors.textPrimary)
                .textSelection(.enabled)
                .lineSpacing(2)
        }
        .padding(DispatchSpacing.md)
        .background(DispatchColors.errorBackground)
        .clipShape(RoundedRectangle(cornerRadius: DispatchRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: DispatchRadius.md, style: .continuous)
                .strokeBorder(DispatchColors.statusError.opacity(0.25), lineWidth: 1)
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
