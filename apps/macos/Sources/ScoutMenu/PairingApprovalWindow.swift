import AppKit
import Combine
import ScoutAppCore
import SwiftUI

/// A focused, floating "a device wants to pair" popup. It pops up on top the
/// moment a request arrives (driven by the always-running menu app), so
/// approval doesn't depend on opening the popover or on flaky notification
/// actions. It's not closable — pairing is a decision, so the only ways out are
/// Allow, Deny, or the request expiring (which auto-dismisses it).
@MainActor
final class PairingApprovalWindowController {
    static let shared = PairingApprovalWindowController()

    private var window: NSWindow?
    private var cancellable: AnyCancellable?
    private let controller = OpenScoutAppController.shared

    func start() {
        cancellable = controller.$pendingPairingRequests
            .receive(on: RunLoop.main)
            .sink { [weak self] requests in
                guard let self else { return }
                if requests.isEmpty {
                    self.hide()
                } else if self.window?.isVisible != true {
                    self.present()
                }
            }
    }

    private func present() {
        let window = ensureWindow()
        window.makeKeyAndOrderFront(nil)
        window.center()
        NSApp.activate(ignoringOtherApps: true)
    }

    private func hide() {
        window?.orderOut(nil)
    }

    private func ensureWindow() -> NSWindow {
        if let window { return window }
        let host = NSHostingController(rootView: PairingApprovalPanelView(controller: controller))
        host.sizingOptions = .preferredContentSize
        let window = NSWindow(contentViewController: host)
        // No `.closable`: a pairing request is a decision (Allow/Deny), and it
        // auto-dismisses when decided or expired.
        window.styleMask = [.titled, .fullSizeContentView]
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.isMovableByWindowBackground = true
        window.level = .floating
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        window.isReleasedWhenClosed = false
        window.backgroundColor = .clear
        window.hasShadow = true
        window.appearance = NSAppearance(named: .darkAqua)
        self.window = window
        return window
    }
}

/// The popup's content — a decisive Allow/Deny card. Reads the live request off
/// the controller so a second request (or expiry) updates in place.
struct PairingApprovalPanelView: View {
    @ObservedObject var controller: OpenScoutAppController

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(ShellPalette.shellBackground)
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(ShellPalette.accent.opacity(0.35), lineWidth: 1)
            content
                .padding(20)
        }
        .frame(width: 340)
        .preferredColorScheme(.dark)
    }

    @ViewBuilder private var content: some View {
        if let request = controller.pendingPairingRequests.first {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 12) {
                    Image(systemName: "iphone")
                        .font(.system(size: 26, weight: .regular))
                        .foregroundStyle(ShellPalette.accent)
                        .frame(width: 30)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("PAIRING REQUEST")
                            .font(MenuType.mono(9, weight: .semibold))
                            .tracking(1.4)
                            .foregroundStyle(ShellPalette.accent)
                        Text("\(request.displayName) wants to pair")
                            .font(MenuType.title(15))
                            .foregroundStyle(ShellPalette.ink)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                }

                Text("A device on your network is asking to pair with this Mac. Allowing trusts it to see and control your agents.")
                    .font(MenuType.body(12))
                    .foregroundStyle(ShellPalette.copy)
                    .fixedSize(horizontal: false, vertical: true)

                if let ip = request.requesterIp {
                    Text(ip)
                        .font(MenuType.mono(10))
                        .foregroundStyle(ShellPalette.muted)
                }

                if controller.pendingPairingRequests.count > 1 {
                    Text("+\(controller.pendingPairingRequests.count - 1) more waiting")
                        .font(MenuType.mono(9, weight: .semibold))
                        .foregroundStyle(ShellPalette.muted)
                }

                HStack(spacing: 10) {
                    Button {
                        controller.denyPairingRequest(request.token)
                    } label: {
                        Text("Deny")
                            .font(MenuType.bodyMedium(12))
                            .foregroundStyle(ShellPalette.copy)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                            .background(
                                RoundedRectangle(cornerRadius: 7, style: .continuous)
                                    .stroke(ShellPalette.line, lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                    .disabled(controller.pairingApprovalPending)

                    Button {
                        controller.approvePairingRequest(request.token)
                    } label: {
                        Text(controller.pairingApprovalPending ? "Allowing…" : "Allow")
                            .font(MenuType.bodyMedium(12))
                            .foregroundStyle(ShellPalette.ink)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 8)
                            .background(
                                RoundedRectangle(cornerRadius: 7, style: .continuous)
                                    .fill(ShellPalette.accent.opacity(0.20))
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 7, style: .continuous)
                                    .stroke(ShellPalette.accent.opacity(0.6), lineWidth: 1)
                            )
                    }
                    .buttonStyle(.plain)
                    .disabled(controller.pairingApprovalPending)
                }
            }
        }
    }
}
