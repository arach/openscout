import HudsonObservability
import SwiftUI

public struct ScoutLogPanel: View {
    @ObservedObject private var store: HudLogStore
    private let title: String
    private let onClose: () -> Void

    public init(
        title: String = "Activity Log",
        store: HudLogStore = .shared,
        onClose: @escaping () -> Void
    ) {
        self.title = title
        self.store = store
        self.onClose = onClose
    }

    public var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            if store.entries.isEmpty {
                ContentUnavailableView("No log entries", systemImage: "list.bullet.rectangle")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(store.entries.reversed()) { entry in
                            ScoutLogEntryRow(entry: entry)
                        }
                    }
                    .padding(12)
                }
            }
        }
        .frame(minWidth: 360, minHeight: 420)
    }

    private var header: some View {
        HStack(spacing: 10) {
            Text(title)
                .font(.headline)
            Spacer()
            Text("\(store.entries.count)")
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(.secondary)
            Button("Clear") {
                store.clear()
            }
            .disabled(store.entries.isEmpty)
            Button {
                onClose()
            } label: {
                Image(systemName: "xmark")
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close activity log")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }
}

public struct ScoutLogStatusItem: View {
    @ObservedObject private var store: HudLogStore
    private let label: String
    private let showCounts: Bool

    public init(store: HudLogStore = .shared, label: String = "Logs", showCounts: Bool = true) {
        self.store = store
        self.label = label
        self.showCounts = showCounts
    }

    public var body: some View {
        HStack(spacing: 5) {
            HStack(spacing: 5) {
                Image(systemName: "tray.full")
                Text(label)
            }
            .foregroundStyle(.secondary)

            if showCounts, let countSummary {
                Text(countSummary)
                    .font(.system(.caption2, design: .monospaced))
                    .foregroundStyle(errorCount > 0 ? .red : warningCount > 0 ? .orange : .secondary)
            }
        }
    }

    private var warningCount: Int {
        store.entries.filter { $0.level == .warning }.count
    }

    private var errorCount: Int {
        store.entries.filter { $0.level == .error || $0.level == .fault }.count
    }

    private var countSummary: String? {
        if errorCount > 0 { return "\(errorCount)E" }
        if warningCount > 0 { return "\(warningCount)W" }
        return nil
    }
}

private struct ScoutLogEntryRow: View {
    let entry: HudLogEntry

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            RoundedRectangle(cornerRadius: 2)
                .fill(tint)
                .frame(width: 3)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text(entry.level.rawValue.uppercased())
                        .font(.system(.caption2, design: .monospaced).weight(.bold))
                        .foregroundStyle(tint)
                    Text(entry.category)
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(.secondary)
                    Spacer(minLength: 0)
                    Text(entry.formattedTime)
                        .font(.system(.caption2, design: .monospaced))
                        .foregroundStyle(.tertiary)
                }
                Text(entry.message)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(.primary)
                    .lineLimit(4)
                    .textSelection(.enabled)
            }
        }
        .padding(10)
        .background(.quaternary.opacity(0.35), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private var tint: Color {
        switch entry.level {
        case .debug:
            .gray
        case .info:
            .blue
        case .notice:
            .teal
        case .warning:
            .orange
        case .error, .fault:
            .red
        }
    }
}
