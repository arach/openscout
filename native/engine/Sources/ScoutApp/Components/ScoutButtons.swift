import SwiftUI

enum ScoutButtonTone {
    case primary
    case secondary
    case quiet
}

struct ScoutButtonStyle: ButtonStyle {
    let tone: ScoutButtonTone

    init(tone: ScoutButtonTone = .secondary) {
        self.tone = tone
    }

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(foregroundColor)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(backgroundStyle)
                    .overlay(
                        RoundedRectangle(cornerRadius: 6)
                            .strokeBorder(borderColor, lineWidth: tone == .primary ? 0 : 1)
                    )
            )
            .opacity(configuration.isPressed ? 0.84 : 1)
    }

    private var foregroundColor: some ShapeStyle {
        switch tone {
        case .primary:
            return AnyShapeStyle(Color.white)
        case .secondary:
            return AnyShapeStyle(ScoutTheme.inkSecondary)
        case .quiet:
            return AnyShapeStyle(ScoutTheme.inkMuted)
        }
    }

    private var backgroundStyle: some ShapeStyle {
        switch tone {
        case .primary:
            return AnyShapeStyle(ScoutTheme.accent)
        case .secondary:
            return AnyShapeStyle(.thinMaterial)
        case .quiet:
            return AnyShapeStyle(ScoutTheme.hover)
        }
    }

    private var borderColor: Color {
        switch tone {
        case .primary:
            return .clear
        case .secondary, .quiet:
            return ScoutTheme.border
        }
    }
}
