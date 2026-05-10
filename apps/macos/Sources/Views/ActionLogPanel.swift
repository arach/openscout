import AppKit
import SwiftUI

struct ActionLogPanel: View {
    let entries: [OpenScoutAppController.ActionLogEntry]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("ACTIVITY")
                    .font(MenuType.mono(9, weight: .bold))
                    .tracking(1.2)
                    .foregroundStyle(ShellPalette.dim)
                Spacer()
            }
            .padding(.horizontal, 4)

            ScrollViewReader { proxy in
                ScrollView(showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 3) {
                        ForEach(entries) { entry in
                            ActionLogRow(entry: entry)
                                .id(entry.id)
                                .transition(.opacity)
                        }
                    }
                    .padding(.horizontal, 6)
                    .padding(.vertical, 4)
                }
                .onChange(of: entries.count) { _, _ in
                    if let last = entries.last {
                        withAnimation(.easeOut(duration: 0.15)) {
                            proxy.scrollTo(last.id, anchor: .bottom)
                        }
                    }
                }
            }
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(ShellPalette.surfaceFill)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .stroke(ShellPalette.line, lineWidth: 1)
            )
        }
        .animation(.easeOut(duration: 0.18), value: entries.count)
    }
}

private struct ActionLogRow: View {
    let entry: OpenScoutAppController.ActionLogEntry

    @State private var copied = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(glyph)
                .font(MenuType.mono(10, weight: .bold))
                .foregroundStyle(tint)
                .frame(width: 10, alignment: .leading)

            Text(timestamp)
                .font(MenuType.mono(9, weight: .regular))
                .foregroundStyle(ShellPalette.muted)
                .monospacedDigit()

            Text(entry.text)
                .font(MenuType.mono(10, weight: .regular))
                .foregroundStyle(textColor)
                .lineLimit(2)
                .truncationMode(.tail)
                .textSelection(.enabled)

            Spacer(minLength: 4)

            if entry.kind == .error, let copy = entry.copyDetails {
                Button(action: { copyToPasteboard(copy) }) {
                    Text(copied ? "COPIED" : "COPY")
                        .font(MenuType.mono(8, weight: .bold))
                        .tracking(0.8)
                        .foregroundStyle(ShellPalette.ink)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(
                            RoundedRectangle(cornerRadius: 3, style: .continuous)
                                .fill(ShellPalette.surfaceFillStrong)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 3, style: .continuous)
                                .stroke(ShellPalette.lineStrong, lineWidth: 1)
                        )
                }
                .buttonStyle(.plain)
                .help("Copy error + recent log lines")
            }
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 2)
    }

    private var glyph: String {
        switch entry.kind {
        case .info:    return "•"
        case .success: return "✓"
        case .error:   return "✗"
        }
    }

    private var tint: Color {
        switch entry.kind {
        case .info:    return ShellPalette.dim
        case .success: return ShellPalette.success
        case .error:   return ShellPalette.error
        }
    }

    private var textColor: Color {
        switch entry.kind {
        case .error: return ShellPalette.error
        default:     return ShellPalette.ink
        }
    }

    private var timestamp: String {
        let f = DateFormatter()
        f.dateFormat = "HH:mm:ss"
        return f.string(from: entry.ts)
    }

    private func copyToPasteboard(_ text: String) {
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(text, forType: .string)
        copied = true
        Task {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            await MainActor.run { copied = false }
        }
    }
}
