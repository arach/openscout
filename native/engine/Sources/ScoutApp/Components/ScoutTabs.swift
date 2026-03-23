import SwiftUI

struct ScoutTabItem<ID: Hashable>: Identifiable {
    let id: ID
    let title: String

    var identity: ID { id }
}

extension ScoutTabItem {
    var itemId: ID { id }
}

struct ScoutTabBar<ID: Hashable>: View {
    let items: [ScoutTabItem<ID>]
    @Binding var selection: ID

    var body: some View {
        HStack(spacing: 8) {
            ForEach(items, id: \.itemId) { item in
                Button(item.title) {
                    selection = item.id
                }
                .buttonStyle(ScoutTabButtonStyle(isSelected: selection == item.id))
            }
        }
    }
}

private struct ScoutTabButtonStyle: ButtonStyle {
    let isSelected: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(isSelected ? ScoutTheme.ink : ScoutTheme.inkMuted)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(isSelected ? ScoutTheme.selection : ScoutTheme.hover.opacity(configuration.isPressed ? 1 : 0.35))
                    .overlay(
                        RoundedRectangle(cornerRadius: 6)
                            .strokeBorder(isSelected ? ScoutTheme.accent.opacity(0.18) : ScoutTheme.border, lineWidth: 1)
                    )
            )
    }
}
