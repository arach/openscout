import SwiftUI

enum ServiceLightStatus {
    case healthy
    case warn
    case fail
    case pending

    var dotColor: Color {
        switch self {
        case .healthy: return ShellPalette.success
        case .warn: return ShellPalette.warning
        case .fail: return ShellPalette.error
        case .pending: return ShellPalette.dim
        }
    }

    var ringColor: Color {
        switch self {
        case .healthy: return ShellPalette.success.opacity(0.35)
        case .warn: return ShellPalette.warning.opacity(0.35)
        case .fail: return ShellPalette.error.opacity(0.35)
        case .pending: return ShellPalette.lineStrong
        }
    }

    var allowsExpansion: Bool {
        switch self {
        case .warn, .fail: return true
        case .healthy, .pending: return false
        }
    }
}

struct ServiceLightAction {
    let title: String
    let role: Role
    let perform: () -> Void
    let disabled: Bool

    enum Role {
        case primary
        case secondary
    }

    init(title: String, role: Role = .primary, disabled: Bool = false, perform: @escaping () -> Void) {
        self.title = title
        self.role = role
        self.disabled = disabled
        self.perform = perform
    }
}

struct ServiceLightChip {
    let symbol: String
    let label: String
}

struct ServiceLight: Identifiable {
    let id: String
    let label: String
    let status: ServiceLightStatus
    let summary: String
    let detail: String
    let chip: ServiceLightChip?
    let actions: [ServiceLightAction]
    let footnote: String?

    init(
        id: String,
        label: String,
        status: ServiceLightStatus,
        summary: String,
        detail: String,
        chip: ServiceLightChip? = nil,
        actions: [ServiceLightAction] = [],
        footnote: String? = nil
    ) {
        self.id = id
        self.label = label
        self.status = status
        self.summary = summary
        self.detail = detail
        self.chip = chip
        self.actions = actions
        self.footnote = footnote
    }
}

/// Vertical stack of service rows. Collapsed rows are short, single-line.
/// Expanding any row pushes the others down — no dead horizontal columns.
struct ServiceLightRow: View {
    let lights: [ServiceLight]

    @State private var expandedIDs: Set<String> = []

    var body: some View {
        VStack(spacing: 0) {
            ForEach(Array(lights.enumerated()), id: \.element.id) { index, light in
                if index > 0 {
                    Rectangle()
                        .fill(ShellPalette.line)
                        .frame(height: 1)
                }
                ServiceLightCell(
                    light: light,
                    isExpanded: isExpanded(light),
                    canToggle: light.status.allowsExpansion
                ) {
                    toggle(light)
                }
            }
        }
        .onAppear {
            expandedIDs = Set(lights.filter { $0.status.allowsExpansion }.map(\.id))
        }
        .onChange(of: signature(for: lights)) { _, _ in
            reconcile()
        }
    }

    private func isExpanded(_ light: ServiceLight) -> Bool {
        guard light.status.allowsExpansion else {
            return false
        }
        return expandedIDs.contains(light.id)
    }

    private func toggle(_ light: ServiceLight) {
        guard light.status.allowsExpansion else {
            return
        }
        withAnimation(.easeInOut(duration: 0.18)) {
            if expandedIDs.contains(light.id) {
                expandedIDs.remove(light.id)
            } else {
                expandedIDs.insert(light.id)
            }
        }
    }

    private func reconcile() {
        let allowed = Set(lights.filter { $0.status.allowsExpansion }.map(\.id))
        let toAdd = allowed.subtracting(expandedIDs)
        let toRemove = expandedIDs.subtracting(allowed)
        guard !toAdd.isEmpty || !toRemove.isEmpty else {
            return
        }
        withAnimation(.easeInOut(duration: 0.18)) {
            expandedIDs.formUnion(toAdd)
            expandedIDs.subtract(toRemove)
        }
    }

    private func signature(for lights: [ServiceLight]) -> String {
        lights.map { "\($0.id):\($0.status)" }.joined(separator: "|")
    }
}

private struct ServiceLightCell: View {
    let light: ServiceLight
    let isExpanded: Bool
    let canToggle: Bool
    let onToggle: () -> Void

    // Fixed widths keep label/summary aligned across the three rows so they
    // read like a tabular console rather than three independent cards.
    private let labelColumnWidth: CGFloat = 80

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if canToggle {
                Button(action: onToggle) {
                    compactRow
                }
                .buttonStyle(.plain)
            } else {
                compactRow
            }

            if isExpanded {
                expansion
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(.horizontal, 4)
        .padding(.vertical, isExpanded ? 8 : 6)
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    private var compactRow: some View {
        HStack(alignment: .center, spacing: 10) {
            statusIndicator

            HStack(spacing: 7) {
                ServiceGlyph(
                    kind: ServiceGlyph.kind(forServiceID: light.id),
                    size: 14,
                    color: ShellPalette.ink
                )

                Text(light.label.uppercased())
                    .font(MenuType.mono(9, weight: .bold))
                    .tracking(0.5)
                    .foregroundStyle(ShellPalette.ink)
                    .lineLimit(1)
            }
            .frame(width: labelColumnWidth, alignment: .leading)

            Text(light.summary)
                .font(MenuType.mono(11, weight: .semibold))
                .foregroundStyle(ShellPalette.ink)
                .lineLimit(1)
                .truncationMode(.tail)
                .allowsTightening(true)

            if let chip = light.chip {
                chipView(chip)
            }

            Spacer(minLength: 8)

            if let footnote = light.footnote, !footnote.isEmpty, !canToggle {
                Text(footnote)
                    .font(MenuType.mono(9))
                    .foregroundStyle(ShellPalette.muted)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            if canToggle {
                Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundStyle(ShellPalette.muted)
                    .frame(width: 12)
            }
        }
        .contentShape(Rectangle())
    }

    private var statusIndicator: some View {
        ZStack {
            if light.status == .pending {
                ProgressView()
                    .controlSize(.small)
                    .scaleEffect(0.6)
                    .frame(width: 14, height: 14)
            } else {
                Circle()
                    .fill(light.status.dotColor)
                    .frame(width: 8, height: 8)
            }
        }
        .frame(width: 14, height: 14)
    }

    private var expansion: some View {
        VStack(alignment: .leading, spacing: 8) {
            Rectangle()
                .fill(ShellPalette.line)
                .frame(height: 1)
                .padding(.top, 8)

            if !light.detail.isEmpty {
                Text(light.detail)
                    .font(MenuType.body(11))
                    .foregroundStyle(ShellPalette.copy)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            if let footnote = light.footnote, !footnote.isEmpty {
                Text(footnote)
                    .font(MenuType.mono(9))
                    .foregroundStyle(ShellPalette.muted)
                    .lineLimit(2)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            if !light.actions.isEmpty {
                HStack(spacing: 6) {
                    Spacer(minLength: 0)
                    ForEach(Array(light.actions.enumerated()), id: \.offset) { _, action in
                        actionButton(action)
                    }
                }
            }
        }
        .padding(.leading, 24) // align expansion content with summary column
    }

    @ViewBuilder
    private func actionButton(_ action: ServiceLightAction) -> some View {
        switch action.role {
        case .primary:
            Button(action.title, action: action.perform)
                .buttonStyle(PrimaryPillStyle())
                .disabled(action.disabled)
        case .secondary:
            Button(action.title, action: action.perform)
                .buttonStyle(SecondaryPillStyle())
                .disabled(action.disabled)
        }
    }

    private func chipView(_ chip: ServiceLightChip) -> some View {
        HStack(spacing: 4) {
            Image(systemName: chip.symbol)
                .font(.system(size: 8, weight: .semibold))
            Text(chip.label)
                .font(MenuType.mono(8, weight: .bold))
                .tracking(0.7)
                .lineLimit(1)
        }
        .foregroundStyle(ShellPalette.dim)
        .padding(.horizontal, 5)
        .padding(.vertical, 2)
        .background(
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(ShellPalette.chipFill)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .stroke(ShellPalette.line, lineWidth: 1)
        )
    }

    private var borderColor: Color {
        ShellPalette.line
    }
}
