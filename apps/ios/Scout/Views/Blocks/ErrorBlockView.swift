// ErrorBlockView — Red-tinted error card with monospace message.

import SwiftUI

struct ErrorBlockView: View {
    let block: Block

    @State private var didCopy = false

    private var errorMessage: String {
        block.message ?? "An unknown error occurred"
    }

    private var copyPayload: String {
        if let code = block.code, !code.isEmpty {
            return "[\(code)] \(errorMessage)"
        }
        return errorMessage
    }

    var body: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.sm) {
            HStack(spacing: ScoutSpacing.sm) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 14))
                    .foregroundStyle(ScoutColors.statusError)

                Text("Error")
                    .font(ScoutTypography.body(14, weight: .semibold))
                    .foregroundStyle(ScoutColors.statusError)

                Spacer()

                if let code = block.code {
                    Text(code)
                        .font(ScoutTypography.codeCaption)
                        .foregroundStyle(ScoutColors.statusError.opacity(0.7))
                        .padding(.horizontal, ScoutSpacing.sm)
                        .padding(.vertical, ScoutSpacing.xxs)
                        .background(ScoutColors.statusError.opacity(0.1))
                        .clipShape(Capsule())
                }

                Button {
                    UIPasteboard.general.string = copyPayload
                    didCopy = true
                    Task {
                        try? await Task.sleep(for: .seconds(1.5))
                        didCopy = false
                    }
                } label: {
                    Image(systemName: didCopy ? "checkmark" : "doc.on.doc")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(didCopy ? ScoutColors.statusError : ScoutColors.statusError.opacity(0.7))
                        .frame(width: 24, height: 24)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(didCopy ? "Copied" : "Copy error details")
            }

            Text(errorMessage)
                .font(ScoutTypography.codeBody)
                .foregroundStyle(ScoutColors.textPrimary)
                .textSelection(.enabled)
                .lineSpacing(2)
        }
        .padding(ScoutSpacing.md)
        .background(ScoutColors.errorBackground)
        .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous)
                .strokeBorder(ScoutColors.statusError.opacity(0.25), lineWidth: 1)
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
