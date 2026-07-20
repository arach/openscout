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
                    LazyVStack(spacing: 0) {
                        ForEach(store.entries.reversed()) { entry in
                            ScoutLogEntryRow(entry: entry)
                        }
                    }
                    .padding(.vertical, 4)
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
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .disabled(store.entries.isEmpty)
            .accessibilityHint("Removes all visible log entries")
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
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(entry.formattedTime)
                .foregroundStyle(.tertiary)
                .frame(width: 76, alignment: .leading)

            Text(levelLabel)
                .fontWeight(.semibold)
                .foregroundStyle(tint)
                .frame(width: 24, alignment: .leading)

            Text(entry.category)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(width: 78, alignment: .leading)

            Text(entry.message)
                .foregroundStyle(.primary)
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)
        }
        .font(.system(.caption2, design: .monospaced))
        .padding(.horizontal, 10)
        .padding(.vertical, 3)
        .overlay(alignment: .bottom) {
            Divider()
        }
        .help("\(entry.formattedTime) \(levelLabel) [\(entry.category)] \(entry.message)")
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(entry.formattedTime), \(entry.level.rawValue), \(entry.category), \(entry.message)")
    }

    private var levelLabel: String {
        switch entry.level {
        case .debug:
            "DBG"
        case .info:
            "INF"
        case .notice:
            "NTC"
        case .warning:
            "WRN"
        case .error:
            "ERR"
        case .fault:
            "FLT"
        }
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
