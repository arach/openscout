import SwiftUI
import HudsonUI
import HudsonUIWeb

/// A native iPad host for Scout Web's purpose-built mission-control embeds.
/// The web app remains the single implementation of Lanes and Dispatch; iOS
/// supplies connection provenance, loading state, and a contained retry path.
struct MissionControlSurface: View {
    enum Kind: String, Equatable {
        case lanes = "Lanes"
        case dispatch = "Dispatch"

        var embedPath: String {
            switch self {
            case .lanes: return "/embed/agent-lanes"
            case .dispatch: return "/embed/dispatch"
            }
        }
    }

    let model: AppModel
    let kind: Kind
    let isActive: Bool

    @State private var webState = HudWebViewState()
    @State private var reloadGeneration = 0
    @StateObject private var entrance = CockpitEntrancePhase()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var sourceURL: URL? {
        // Re-resolve on connection changes: `webAccessHost` is nil while the
        // bridge handshake settles, and keep-alive mounting evaluates this long
        // before that. Reading `connectionState` subscribes the surface so the
        // embed appears once the route lands (previously the surface only
        // mounted on tap, when everything was already warm).
        _ = model.connectionState
        guard let base = model.missionControlURL(path: kind.embedPath),
              var components = URLComponents(url: base, resolvingAgainstBaseURL: false) else {
            return nil
        }
        components.queryItems = [URLQueryItem(name: "nativeReload", value: String(reloadGeneration))]
        return components.url
    }

    var body: some View {
        VStack(spacing: 0) {
            toolbar
                .cockpitEntrance(index: 0, phase: entrance)
            Group {
                // Create each WKWebView lazily on first activation, then leave it
                // mounted and warm across every subsequent tab switch.
                if !entrance.hasEntered {
                    Color.clear
                } else if let sourceURL {
                    HudWebSurface(
                        HudWebSurfaceDescriptor(
                            id: "scout.ios.\(kind.rawValue.lowercased())",
                            title: kind.rawValue,
                            location: .paired(sourceURL),
                            lifecycle: .keepWarm
                        ),
                        state: $webState,
                        configuration: HudWebViewConfiguration(
                            allowsBackForwardNavigationGestures: true,
                            allowsJavaScript: true,
                            customUserAgent: "Scout-iPad/1 MissionControl",
                            usesNonPersistentDataStore: false,
                            isInspectable: true
                        )
                    )
                    .id(reloadGeneration)
                    .overlay {
                        if let message = webState.errorMessage {
                            unavailable(title: "Couldn’t load \(kind.rawValue)", detail: message)
                        }
                    }
                } else {
                    unavailable(
                        title: "\(kind.rawValue) unavailable",
                        detail: "Connect this iPad to a paired Mac over LAN or Tailnet."
                    )
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(HudPalette.bg)
            .cockpitEntrance(index: 1, phase: entrance)
        }
        .task(id: isActive) {
            await entrance.reveal(when: isActive, animated: !reduceMotion)
        }
    }

    private var toolbar: some View {
        HStack(spacing: HudSpacing.md) {
            HudSectionLabel(kind.rawValue, tint: ScoutInk.muted)
            if let host = sourceURL?.host {
                Text(host.uppercased())
                    .font(HudFont.mono(HudTextSize.micro, weight: .medium))
                    .tracking(0.5)
                    .foregroundStyle(ScoutInk.dim)
                    .lineLimit(1)
            }
            Spacer(minLength: HudSpacing.md)
            if webState.isLoading {
                ProgressView()
                    .controlSize(.small)
                    .tint(HudPalette.accent)
            }
            Button("Reload") {
                webState = HudWebViewState()
                reloadGeneration += 1
            }
            .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
            .foregroundStyle(HudPalette.accent)
            .buttonStyle(.plain)
        }
        .padding(.horizontal, HudSpacing.xxl)
        .padding(.vertical, HudSpacing.sm)
        .overlay(alignment: .bottom) {
            Rectangle().fill(HudHairline.standard).frame(height: HudStrokeWidth.thin)
        }
    }

    private func unavailable(title: String, detail: String) -> some View {
        HudEmptyState(title: title, subtitle: detail, icon: "rectangle.connected.to.line.below")
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .padding(HudSpacing.xxl)
            .background(HudPalette.bg)
    }
}
