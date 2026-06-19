import Foundation
import HudsonUI
import ScoutAppCore
import ScoutSharedUI
import SwiftUI

/// Polls the web server for incoming LAN pairing requests and decides them.
///
/// Initial pairing is trust-on-first-use, so a phone tapping this Mac parks
/// until a human approves it here. Mirrors the menu-bar app + web prompt; all
/// three read `/api/pairing/requests` and POST `/decide`.
@MainActor
final class ScoutPairingApprovalStore: ObservableObject {
    @Published private(set) var pending: [ScoutPairingRequest] = []
    @Published private(set) var decisionPending = false

    private var pollTask: Task<Void, Never>?
    private static let pollIntervalNanoseconds: UInt64 = 2_500_000_000

    func start() {
        guard pollTask == nil else { return }
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(nanoseconds: Self.pollIntervalNanoseconds)
            }
        }
    }

    func stop() {
        pollTask?.cancel()
        pollTask = nil
    }

    private func refresh() async {
        // Keep the last set on a transient error rather than flicker the prompt.
        guard let requests = try? await ScoutPairingRequests.fetchPending() else { return }
        pending = requests
    }

    func approve(_ token: String) { decide(token, approve: true) }
    func deny(_ token: String) { decide(token, approve: false) }

    private func decide(_ token: String, approve: Bool) {
        guard !decisionPending else { return }
        decisionPending = true
        // Drop immediately so the prompt dismisses without waiting on the poll.
        pending.removeAll { $0.token == token }
        Task {
            defer { decisionPending = false }
            try? await ScoutPairingRequests.decide(token: token, approve: approve)
            await refresh()
        }
    }
}

/// Bottom-trailing approval card shown over the main window when a device wants
/// to pair. Matches Scout's design tokens.
struct ScoutPairingApprovalPrompt: View {
    @ObservedObject var store: ScoutPairingApprovalStore

    var body: some View {
        if let request = store.pending.first {
            card(request)
                .padding(HudSpacing.xl)
                .transition(.opacity.combined(with: .move(edge: .bottom)))
                .animation(.easeOut(duration: 0.16), value: store.pending.count)
        }
    }

    private func card(_ request: ScoutPairingRequest) -> some View {
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            HStack(spacing: HudSpacing.xs) {
                Image(systemName: "lock.shield")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(ScoutPalette.accent)
                Text("PAIRING REQUEST")
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .tracking(1.0)
                    .foregroundStyle(ScoutPalette.accent)
                Spacer(minLength: HudSpacing.sm)
                if store.pending.count > 1 {
                    Text("+\(store.pending.count - 1) more")
                        .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                        .foregroundStyle(ScoutPalette.muted)
                }
            }

            Text("\(request.displayName) wants to pair")
                .font(HudFont.ui(HudTextSize.base, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)
                .lineLimit(1)
                .truncationMode(.tail)

            Text("On your network\(request.requesterIp.map { " · \($0)" } ?? ""). Allowing trusts this device and starts pair mode.")
                .font(HudFont.ui(HudTextSize.xs))
                .foregroundStyle(ScoutPalette.muted)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: HudSpacing.sm) {
                Spacer(minLength: 0)
                Button {
                    store.deny(request.token)
                } label: {
                    Text("Deny")
                        .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                        .foregroundStyle(ScoutPalette.ink)
                        .padding(.horizontal, HudSpacing.lg)
                        .padding(.vertical, HudSpacing.xs)
                        .overlay(
                            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                                .stroke(ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
                        )
                }
                .buttonStyle(.plain)
                .disabled(store.decisionPending)

                Button {
                    store.approve(request.token)
                } label: {
                    Text(store.decisionPending ? "Allowing…" : "Allow")
                        .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                        .foregroundStyle(ScoutPalette.ink)
                        .padding(.horizontal, HudSpacing.lg)
                        .padding(.vertical, HudSpacing.xs)
                        .background(
                            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                                .fill(ScoutPalette.accent.opacity(0.18))
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                                .stroke(ScoutPalette.accent.opacity(0.55), lineWidth: HudStrokeWidth.thin)
                        )
                }
                .buttonStyle(.plain)
                .disabled(store.decisionPending)
            }
            .padding(.top, HudSpacing.xxs)
        }
        .padding(HudSpacing.lg)
        .frame(width: 320, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .fill(ScoutPalette.accentSoft)
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .stroke(ScoutPalette.accent.opacity(0.4), lineWidth: HudStrokeWidth.thin)
        )
        .shadow(color: ScoutSurface.shadow(0.18), radius: 12, x: 0, y: 4)
    }
}
