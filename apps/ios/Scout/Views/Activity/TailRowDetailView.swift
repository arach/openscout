// TailRowDetailView — detail sheet for a single TailFeedRow.
//
// Tapping a row in the Tail firehose opens this sheet so the full snippet is
// readable (no truncation, selectable) and every metadata field is one tap to
// copy. Matches the parent surface's monospaced htop/journalctl aesthetic.

import SwiftUI
import UIKit

struct TailRowDetailView: View {
    let row: TailFeedRow
    var onOpenSession: ((String) -> Void)? = nil

    @Environment(\.dismiss) private var dismiss
    @State private var copiedKey: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: ScoutSpacing.lg) {
                    summarySection
                    metadataSection
                    if let sid = sessionId {
                        openSessionButton(sid)
                    }
                    rawSection
                }
                .padding(.horizontal, ScoutSpacing.lg)
                .padding(.vertical, ScoutSpacing.md)
            }
            .background(ScoutColors.backgroundAdaptive)
            .navigationTitle(titleText)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close") { dismiss() }
                        .font(ScoutTypography.code(12, weight: .medium))
                        .foregroundStyle(ScoutColors.textSecondary)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        Button {
                            copy(copyLine(for: row), key: "menu.line")
                        } label: {
                            Label("Copy line", systemImage: "doc.on.doc")
                        }
                        Button {
                            copy(rawJSON, key: "menu.raw")
                        } label: {
                            Label("Copy raw JSON", systemImage: "curlybraces")
                        }
                    } label: {
                        Image(systemName: "square.and.arrow.up")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(ScoutColors.textSecondary)
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    // MARK: - Sections

    private var summarySection: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.sm) {
            sectionHeader("BODY") { copyChip(text: snippetText, key: "body") }

            Text(snippetText)
                .font(ScoutTypography.code(13))
                .foregroundStyle(ScoutColors.textPrimary)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(ScoutSpacing.md)
                .background(ScoutColors.surfaceRaisedAdaptive)
                .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous))
        }
    }

    private var metadataSection: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.sm) {
            sectionHeader("METADATA")

            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(metadataFields.enumerated()), id: \.offset) { index, field in
                    metadataRow(label: field.label, value: field.value, key: "meta.\(index)")
                    if index < metadataFields.count - 1 {
                        Divider().background(ScoutColors.divider.opacity(0.5))
                    }
                }
            }
            .background(ScoutColors.surfaceRaisedAdaptive)
            .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous))
        }
    }

    private var rawSection: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.sm) {
            sectionHeader("RAW") { copyChip(text: rawJSON, key: "raw") }

            Text(rawJSON)
                .font(ScoutTypography.code(11))
                .foregroundStyle(ScoutColors.textSecondary)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(ScoutSpacing.md)
                .background(ScoutColors.surfaceRaisedAdaptive)
                .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous))
        }
    }

    private func openSessionButton(_ sessionId: String) -> some View {
        Button {
            onOpenSession?(sessionId)
            dismiss()
        } label: {
            HStack(spacing: ScoutSpacing.sm) {
                Image(systemName: "arrow.up.right.square")
                    .font(.system(size: 12, weight: .semibold))
                Text("Open session")
                    .font(ScoutTypography.code(12, weight: .semibold))
                Spacer()
                Text(sessionId.prefix(8))
                    .font(ScoutTypography.code(10))
                    .foregroundStyle(ScoutColors.textMuted)
            }
            .foregroundStyle(ScoutColors.textPrimary)
            .padding(.horizontal, ScoutSpacing.md)
            .padding(.vertical, ScoutSpacing.md)
            .background(ScoutColors.surfaceRaisedAdaptive)
            .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Building blocks

    private func sectionHeader<Trailing: View>(_ text: String, @ViewBuilder trailing: () -> Trailing) -> some View {
        HStack(spacing: ScoutSpacing.sm) {
            Text(text)
                .font(ScoutTypography.code(10, weight: .bold))
                .foregroundStyle(ScoutColors.textMuted)
                .tracking(0.8)
            Spacer()
            trailing()
        }
    }

    private func sectionHeader(_ text: String) -> some View {
        sectionHeader(text) { EmptyView() }
    }

    private func metadataRow(label: String, value: String, key: String) -> some View {
        Button {
            copy(value, key: key)
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: ScoutSpacing.md) {
                Text(label)
                    .font(ScoutTypography.code(10, weight: .medium))
                    .foregroundStyle(ScoutColors.textMuted)
                    .frame(width: 88, alignment: .leading)

                Text(value)
                    .font(ScoutTypography.code(12))
                    .foregroundStyle(ScoutColors.textPrimary)
                    .multilineTextAlignment(.leading)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)

                Image(systemName: copiedKey == key ? "checkmark" : "doc.on.doc")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(copiedKey == key ? ScoutColors.ledGreen : ScoutColors.textMuted)
                    .frame(width: 16, alignment: .trailing)
            }
            .contentShape(Rectangle())
            .padding(.horizontal, ScoutSpacing.md)
            .padding(.vertical, ScoutSpacing.md)
        }
        .buttonStyle(.plain)
    }

    private func copyChip(text: String, key: String) -> some View {
        Button {
            copy(text, key: key)
        } label: {
            HStack(spacing: 4) {
                Image(systemName: copiedKey == key ? "checkmark" : "doc.on.doc")
                    .font(.system(size: 10, weight: .semibold))
                Text(copiedKey == key ? "COPIED" : "COPY")
                    .font(ScoutTypography.code(9, weight: .bold))
                    .tracking(0.6)
            }
            .foregroundStyle(copiedKey == key ? ScoutColors.ledGreen : ScoutColors.textMuted)
            .padding(.horizontal, ScoutSpacing.sm)
            .padding(.vertical, 3)
            .background(
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(ScoutColors.surfaceRaisedAdaptive)
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Copy

    private func copy(_ value: String, key: String) {
        UIPasteboard.general.string = value
        UISelectionFeedbackGenerator().selectionChanged()
        withAnimation(.easeOut(duration: 0.15)) {
            copiedKey = key
        }
        Task {
            try? await Task.sleep(for: .milliseconds(1200))
            await MainActor.run {
                if copiedKey == key {
                    withAnimation(.easeOut(duration: 0.2)) { copiedKey = nil }
                }
            }
        }
    }

    // MARK: - Field derivation

    private var titleText: String {
        switch row {
        case .activity(let item): return item.kindLabel
        case .tail(let event): return event.kind.rawValue.capitalized
        case .turn(let proj): return proj.phase == .start ? "Turn started" : "Turn ended"
        }
    }

    private var sessionId: String? {
        switch row {
        case .activity(let item): return item.sessionId ?? item.conversationId
        case .tail(let event): return event.sessionId
        case .turn(let proj): return proj.sessionId
        }
    }

    private var snippetText: String {
        switch row {
        case .activity(let item):
            return item.title ?? item.summary ?? item.kindLabel
        case .tail(let event):
            return event.summary
        case .turn(let proj):
            return proj.snippet
        }
    }

    private struct Field { let label: String; let value: String }

    private var metadataFields: [Field] {
        var out: [Field] = []
        out.append(Field(label: "time", value: fullTimestamp))
        out.append(Field(label: "epoch ms", value: String(row.tsMs)))

        switch row {
        case .activity(let item):
            out.append(Field(label: "id", value: item.id))
            out.append(Field(label: "kind", value: item.kind))
            if let v = item.actorId { out.append(Field(label: "actor", value: v)) }
            if let v = item.agentId { out.append(Field(label: "agent", value: v)) }
            if let v = item.counterpartId { out.append(Field(label: "counterpart", value: v)) }
            if let v = item.sessionId { out.append(Field(label: "session", value: v)) }
            if let v = item.conversationId { out.append(Field(label: "conversation", value: v)) }
            if let v = item.messageId { out.append(Field(label: "message", value: v)) }
            if let v = item.invocationId { out.append(Field(label: "invocation", value: v)) }
            if let v = item.flightId { out.append(Field(label: "flight", value: v)) }
            if let v = item.recordId { out.append(Field(label: "record", value: v)) }
            if let v = item.workspaceRoot { out.append(Field(label: "workspace", value: v)) }
            if let v = item.projectName { out.append(Field(label: "project", value: v)) }
        case .tail(let event):
            out.append(Field(label: "id", value: event.id))
            out.append(Field(label: "kind", value: event.kind.rawValue))
            out.append(Field(label: "source", value: event.source))
            out.append(Field(label: "harness", value: event.harness.rawValue))
            out.append(Field(label: "session", value: event.sessionId))
            out.append(Field(label: "project", value: event.project))
            out.append(Field(label: "cwd", value: event.cwd))
            out.append(Field(label: "pid", value: String(event.pid)))
            if let pp = event.parentPid {
                out.append(Field(label: "parent pid", value: String(pp)))
            }
        case .turn(let proj):
            out.append(Field(label: "id", value: proj.id))
            out.append(Field(label: "turn", value: proj.turnId))
            out.append(Field(label: "session", value: proj.sessionId))
            out.append(Field(label: "phase", value: proj.phase == .start ? "start" : "end"))
            out.append(Field(label: "user turn", value: proj.isUserTurn ? "true" : "false"))
        }
        return out
    }

    private var fullTimestamp: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss.SSS"
        let date = Date(timeIntervalSince1970: Double(row.tsMs) / 1000.0)
        return formatter.string(from: date)
    }

    private func copyLine(for row: TailFeedRow) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm:ss"
        let date = Date(timeIntervalSince1970: Double(row.tsMs) / 1000.0)
        let ts = formatter.string(from: date)
        switch row {
        case .activity(let item):
            let body = item.title ?? item.summary ?? item.kindLabel
            return "\(ts) [\(item.kind)] \(item.actorId ?? item.agentId ?? "system") · \(body)"
        case .tail(let event):
            return "\(ts) [\(event.kind.rawValue)] \(event.project) · \(event.summary)"
        case .turn(let proj):
            let phase = proj.phase == .start ? "start" : "end"
            return "\(ts) [turn:\(phase)] \(proj.sessionId.prefix(8)) · \(proj.snippet)"
        }
    }

    private var rawJSON: String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        switch row {
        case .activity(let item):
            return encode(item, with: encoder)
        case .tail(let event):
            return encode(event, with: encoder)
        case .turn(let proj):
            var fields: [String: String] = [
                "id": proj.id,
                "turnId": proj.turnId,
                "sessionId": proj.sessionId,
                "tsMs": String(proj.tsMs),
                "phase": proj.phase == .start ? "start" : "end",
                "isUserTurn": proj.isUserTurn ? "true" : "false",
                "snippet": proj.snippet,
            ]
            return fields
                .sorted { $0.key < $1.key }
                .map { "\($0.key): \($0.value)" }
                .joined(separator: "\n")
        }
    }

    private func encode<T: Encodable>(_ value: T, with encoder: JSONEncoder) -> String {
        guard let data = try? encoder.encode(value),
              let text = String(data: data, encoding: .utf8) else {
            return "(unable to encode)"
        }
        return text
    }
}
