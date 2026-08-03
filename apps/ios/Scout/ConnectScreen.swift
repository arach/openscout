import SwiftUI
import HudsonUI
import AuthenticationServices
#if canImport(UIKit)
import UIKit
#endif

/// First-run gate. Nearby Macs are real content, not onboarding illustration:
/// every discovered host is presented as an equal signal until the operator
/// chooses one, then that exact row becomes the authorization surface.
struct ConnectScreen: View {
    @Bindable var model: AppModel

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var showsOtherWays = false
    @State private var selectedLanTargetID: String?

    private var selectedTarget: AppModel.LanPairTarget? {
        guard let selectedLanTargetID else { return nil }
        return model.lanPairTargets.first { $0.id == selectedLanTargetID }
    }

    private var panelTint: Color {
        if selectedLanTargetID != nil, model.lanPairError != nil {
            return ScoutPalette.statusError
        }
        if model.lanPairAwaitingApproval {
            return ScoutPalette.statusWarn
        }
        return ScoutPalette.accent
    }

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    brandHeader

                    introduction
                        .padding(.top, HudSpacing.huge)

                    localSignalRegister
                        .padding(.top, HudSpacing.xxxl)

                    otherWays
                        .padding(.top, HudSpacing.xxxl)

                    nearbyPrivacyNote
                        .padding(.top, HudSpacing.xl)
                }
                .padding(.horizontal, HudSpacing.xxxl)
                .padding(.top, HudSpacing.md)
                .padding(.bottom, HudSpacing.xxxl)
                .frame(maxWidth: 520)
                .frame(minHeight: geometry.size.height, alignment: .top)
                .frame(maxWidth: .infinity)
            }
            .scrollIndicators(.hidden)
        }
        .background {
            ScoutCanvas(isFleetLive: model.lanPairingTargetId != nil)
                .ignoresSafeArea()
        }
        .task {
            await model.refreshLanPairTargets()
            if model.lanPairTargets.isEmpty {
                try? await Task.sleep(for: .seconds(1.5))
                await model.refreshLanPairTargets()
            }
            if model.isOpenScoutNetworkSignedIn {
                await model.refreshOpenScoutNetworkPairTargets()
            }
        }
    }

    private var brandHeader: some View {
        HStack(spacing: HudSpacing.md) {
            Image("ScoutWireMark")
                .renderingMode(.template)
                .resizable()
                .scaledToFit()
                .foregroundStyle(ScoutPalette.ink)
                .frame(width: 28, height: 28)
                .accessibilityHidden(true)

            Text("Scout")
                .font(HudFont.ui(HudTextSize.lg, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)

            Spacer()

            Button("Explore") { model.continueWithoutPairing() }
                .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                .foregroundStyle(ScoutPalette.accent)
                .frame(minWidth: 64, minHeight: 44)
                .buttonStyle(.plain)
                .accessibilityHint("Continue without pairing a Mac")
        }
        .frame(minHeight: 44)
    }

    private var introduction: some View {
        VStack(alignment: .leading, spacing: HudSpacing.sm) {
            Text("Choose a Mac.")
                .font(HudFont.ui(HudTextSize.xxl, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)

            Text("Authorize this iPhone with a Scout host on your network. Direct pairing stays local.")
                .font(HudFont.ui(HudTextSize.sm))
                .foregroundStyle(ScoutInk.muted)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 360, alignment: .leading)
        }
    }

    private var localSignalRegister: some View {
        VStack(spacing: 0) {
            registerHeader

            Rectangle()
                .fill(ScoutSignalSurface.rule)
                .frame(height: HudStrokeWidth.thin)

            if model.lanPairTargets.isEmpty {
                registerEmptyState
            } else {
                ForEach(Array(model.lanPairTargets.enumerated()), id: \.element.id) { index, target in
                    LocalMacSignalRow(
                        index: index,
                        target: target,
                        isPairing: model.lanPairingTargetId == target.id,
                        isAwaitingApproval: model.lanPairAwaitingApproval
                            && model.lanPairingTargetId == target.id,
                        isDisabled: model.lanPairingTargetId != nil,
                        error: selectedLanTargetID == target.id ? model.lanPairError : nil,
                        onPair: { beginPairing(target) }
                    )

                    if index < model.lanPairTargets.count - 1 {
                        Rectangle()
                            .fill(ScoutSignalSurface.rule)
                            .frame(height: HudStrokeWidth.thin)
                            .padding(.leading, 46)
                    }
                }
            }
        }
        // The registration brackets establish a square, technical frame. A
        // chamfer here competes with that geometry, so this register stays
        // orthogonal while the Pair controls retain their touch affordance.
        .signalPanel(accent: panelTint, cut: 0)
        .animation(ScoutMotion.honoring(reduceMotion, ScoutMotion.grow), value: model.lanPairingTargetId)
        .animation(ScoutMotion.honoring(reduceMotion, ScoutMotion.fade), value: model.lanPairError)
    }

    private var registerHeader: some View {
        HStack(spacing: HudSpacing.sm) {
            ScoutSectionLabel("Local signals", tint: panelTint)

            Spacer()

            if !model.lanPairTargets.isEmpty {
                Text(String(format: "%02d VISIBLE", model.lanPairTargets.count))
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .tracking(0.8)
                    .foregroundStyle(ScoutInk.muted)
            }

            Button {
                Task { await model.refreshLanPairTargets() }
            } label: {
                if model.isRefreshingLanPairTargets {
                    ProgressView()
                        .controlSize(.mini)
                        .tint(ScoutInk.muted)
                } else {
                    Image(systemName: "arrow.clockwise")
                        .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                        .foregroundStyle(ScoutInk.muted)
                }
            }
            .frame(width: 44, height: 44)
            .buttonStyle(.plain)
            .disabled(model.isRefreshingLanPairTargets || model.lanPairingTargetId != nil)
            .accessibilityLabel("Scan for Macs again")
        }
        .padding(.leading, HudSpacing.xxxl)
        .padding(.trailing, HudSpacing.sm)
        .frame(minHeight: 52)
    }

    @ViewBuilder private var registerEmptyState: some View {
        if model.isRefreshingLanPairTargets {
            VStack(alignment: .leading, spacing: HudSpacing.xl) {
                LocalScanTrace()

                VStack(alignment: .leading, spacing: HudSpacing.xs) {
                    Text("Listening on this network")
                        .font(HudFont.ui(HudTextSize.md, weight: .semibold))
                        .foregroundStyle(ScoutPalette.ink)
                    Text("Keep Scout open on your Mac. Nearby hosts will appear here.")
                        .font(HudFont.ui(HudTextSize.sm))
                        .foregroundStyle(ScoutInk.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(HudSpacing.xxxl)
            .frame(maxWidth: .infinity, minHeight: 170, alignment: .leading)
            .accessibilityElement(children: .combine)
        } else {
            VStack(alignment: .leading, spacing: HudSpacing.xl) {
                VStack(alignment: .leading, spacing: HudSpacing.xs) {
                    Text(model.lanPairError == nil ? "No local hosts visible" : "Local scan interrupted")
                        .font(HudFont.ui(HudTextSize.md, weight: .semibold))
                        .foregroundStyle(ScoutPalette.ink)

                    Text(model.lanPairError ?? "Open Scout on your Mac and keep both devices on the same Wi-Fi.")
                        .font(HudFont.ui(HudTextSize.sm))
                        .foregroundStyle(model.lanPairError == nil ? ScoutInk.muted : ScoutPalette.statusError)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button {
                    Task { await model.refreshLanPairTargets() }
                } label: {
                    Label("Scan again", systemImage: "arrow.clockwise")
                        .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                        .foregroundStyle(ScoutPalette.accent)
                        .frame(minHeight: 44)
                }
                .buttonStyle(.plain)
            }
            .padding(HudSpacing.xxxl)
            .frame(maxWidth: .infinity, minHeight: 170, alignment: .leading)
        }
    }

    private var otherWays: some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(ScoutHairline.standard)
                .frame(height: HudStrokeWidth.thin)

            Button {
                withAnimation(ScoutMotion.honoring(reduceMotion, ScoutMotion.grow)) {
                    showsOtherWays.toggle()
                }
            } label: {
                HStack(spacing: HudSpacing.md) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Pair another way")
                            .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                            .foregroundStyle(ScoutPalette.ink)
                        Text("QR code, pairing link, or OpenScout Network")
                            .font(HudFont.ui(HudTextSize.xs))
                            .foregroundStyle(ScoutInk.muted)
                    }

                    Spacer()

                    Image(systemName: "chevron.down")
                        .font(HudFont.ui(HudTextSize.xs, weight: .semibold))
                        .foregroundStyle(ScoutInk.muted)
                        .rotationEffect(.degrees(showsOtherWays && !reduceMotion ? 180 : 0))
                }
                .frame(minHeight: 60)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(showsOtherWays ? "Expanded" : "Collapsed")

            if showsOtherWays {
                VStack(spacing: HudSpacing.xl) {
                    manualPairingRoutes
                    Rectangle()
                        .fill(ScoutHairline.subtle)
                        .frame(height: HudStrokeWidth.thin)
                    openScoutNetworkRoutes
                }
                .padding(.top, HudSpacing.md)
                .padding(.bottom, HudSpacing.xl)
                .transition(
                    reduceMotion
                        ? .opacity
                        : .asymmetric(
                            insertion: .opacity.combined(with: .move(edge: .top)),
                            removal: .opacity
                        )
                )
            }
        }
    }

    private var nearbyPrivacyNote: some View {
        Label("Nearby pairing stays on this network.", systemImage: "lock.fill")
            .font(HudFont.ui(HudTextSize.xs))
            .foregroundStyle(ScoutInk.dim)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel("Nearby pairing stays private on this network")
    }

    private var manualPairingRoutes: some View {
        HStack(spacing: HudSpacing.md) {
            SecondaryPairingButton(title: "Scan code", icon: "qrcode.viewfinder") {
                model.showPairing = true
            }

            #if canImport(UIKit)
            SecondaryPairingButton(title: "Paste link", icon: "doc.on.clipboard") {
                guard let pasted = UIPasteboard.general.string, !pasted.isEmpty else { return }
                Task { await model.pairFromLink(pasted) }
            }
            #endif
        }
    }

    @ViewBuilder private var openScoutNetworkRoutes: some View {
        if !model.isOpenScoutNetworkSignedIn {
            VStack(alignment: .leading, spacing: HudSpacing.md) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Away from your Mac?")
                        .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                        .foregroundStyle(ScoutPalette.ink)
                    Text("Sign in to find Macs published through OpenScout Network.")
                        .font(HudFont.ui(HudTextSize.xs))
                        .foregroundStyle(ScoutInk.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }

                SignInWithAppleButton(.signIn) { request in
                    model.prepareAppleSignInRequest(request)
                } onCompletion: { result in
                    model.handleAppleSignInCompletion(result)
                }
                .signInWithAppleButtonStyle(.white)
                .frame(height: 44)
                .frame(maxWidth: .infinity)
                .clipShape(RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous))
                .overlay {
                    NetworkSignInButtonLabel(provider: .apple)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
                .disabled(model.isCompletingAppleSignIn)
                .opacity(model.isCompletingAppleSignIn ? 0.55 : 1)

                Button {
                    model.openOpenScoutNetworkLogin()
                } label: {
                    NetworkSignInButtonLabel(provider: .github)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Sign in with GitHub")
                .frame(maxWidth: .infinity)
            }
        } else if !model.openScoutNetworkPairTargets.isEmpty {
            VStack(spacing: 0) {
                ForEach(model.openScoutNetworkPairTargets) { target in
                    OpenScoutNetworkPairTargetRow(
                        target: target,
                        isPairing: model.openScoutNetworkPairingTargetId == target.id,
                        onPair: { Task { await model.pairWithOpenScoutNetworkTarget(target) } }
                    )
                }
            }
        } else if model.isRefreshingOpenScoutNetworkPairTargets {
            Label("Checking OpenScout Network…", systemImage: "network")
                .font(HudFont.ui(HudTextSize.sm))
                .foregroundStyle(ScoutInk.muted)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else if let error = model.openScoutNetworkPairError {
            Text(error)
                .font(HudFont.ui(HudTextSize.xs))
                .foregroundStyle(ScoutPalette.statusError)
                .fixedSize(horizontal: false, vertical: true)
        } else {
            VStack(alignment: .leading, spacing: HudSpacing.sm) {
                Text("No published Macs found.")
                    .font(HudFont.ui(HudTextSize.sm))
                    .foregroundStyle(ScoutInk.muted)
                Button("Check again") {
                    Task { await model.refreshOpenScoutNetworkPairTargets() }
                }
                .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                .foregroundStyle(ScoutPalette.accent)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func beginPairing(_ target: AppModel.LanPairTarget) {
        selectedLanTargetID = target.id
        Task { await model.pairWithLanTarget(target) }
    }
}

private struct LocalMacSignalRow: View {
    let index: Int
    let target: AppModel.LanPairTarget
    let isPairing: Bool
    let isAwaitingApproval: Bool
    let isDisabled: Bool
    let error: String?
    let onPair: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: HudSpacing.md) {
                Text(String(format: "%02d", index + 1))
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .foregroundStyle(ScoutInk.dim)
                    .frame(width: 22, alignment: .leading)

                Circle()
                    .fill(isPairing ? statusTint : ScoutPalette.accent)
                    .frame(width: 7, height: 7)
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 3) {
                    Text(target.displayName)
                        .font(HudFont.ui(HudTextSize.md, weight: .medium))
                        .foregroundStyle(ScoutPalette.ink)
                        .fixedSize(horizontal: false, vertical: true)

                    Text(rowDetail)
                        .font(HudFont.mono(HudTextSize.micro))
                        .tracking(0.4)
                        .foregroundStyle(error == nil ? ScoutInk.dim : ScoutPalette.statusError)
                        .lineLimit(2)
                }

                Spacer(minLength: HudSpacing.sm)

                if isPairing {
                    Text(isAwaitingApproval ? "WAITING" : "AUTHORIZING")
                        .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                        .tracking(0.7)
                        .foregroundStyle(statusTint)
                } else {
                    Button("Pair", action: onPair)
                        .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                        .foregroundStyle(ScoutPalette.accent)
                        .frame(width: 68, height: 44)
                        .background(
                            Rectangle()
                                .fill(ScoutSurface.inset)
                        )
                        .overlay(
                            Rectangle()
                                .stroke(ScoutHairline.standard, lineWidth: HudStrokeWidth.thin)
                        )
                        .buttonStyle(.plain)
                        .disabled(isDisabled)
                        .opacity(isDisabled ? HudOpacity.muted : 1)
                }
            }
            .padding(.horizontal, HudSpacing.xxxl)
            .frame(minHeight: 68)

            if isPairing {
                Rectangle()
                    .fill(ScoutSignalSurface.rule)
                    .frame(height: HudStrokeWidth.thin)
                    .padding(.horizontal, HudSpacing.xxxl)

                AuthorizationDocket(
                    targetName: target.displayName,
                    isAwaitingApproval: isAwaitingApproval
                )
                .padding(.horizontal, HudSpacing.xxxl)
                .padding(.vertical, HudSpacing.xl)
                .transition(reduceMotion ? .opacity : .opacity.combined(with: .move(edge: .top)))
            } else if let error {
                Rectangle()
                    .fill(ScoutSignalSurface.rule)
                    .frame(height: HudStrokeWidth.thin)
                    .padding(.horizontal, HudSpacing.xxxl)

                VStack(alignment: .leading, spacing: HudSpacing.md) {
                    Text(error)
                        .font(HudFont.ui(HudTextSize.sm))
                        .foregroundStyle(ScoutPalette.statusError)
                        .fixedSize(horizontal: false, vertical: true)

                    Button("Try again", action: onPair)
                        .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                        .foregroundStyle(ScoutPalette.accent)
                        .frame(minHeight: 44)
                        .buttonStyle(.plain)
                }
                .padding(.horizontal, HudSpacing.xxxl)
                .padding(.bottom, HudSpacing.xl)
                .transition(.opacity)
            }
        }
    }

    private var statusTint: Color {
        isAwaitingApproval ? ScoutPalette.statusWarn : ScoutPalette.accent
    }

    private var rowDetail: String {
        if let error { return error }
        if isAwaitingApproval { return "LOCAL · APPROVAL REQUIRED" }
        if isPairing { return "LOCAL · SECURE HANDSHAKE" }
        return "LOCAL · READY"
    }
}

/// The selected Mac earns the authored moment: two identity facets establish a
/// trust line through Scout's nested mark. There is no hardware clip art—the
/// real host name and the authorization state carry the meaning.
private struct AuthorizationDocket: View {
    let targetName: String
    let isAwaitingApproval: Bool

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var signalTravels = false

    private var tint: Color {
        isAwaitingApproval ? ScoutPalette.statusWarn : ScoutPalette.accent
    }

    var body: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xl) {
            HStack {
                Text("THIS IPHONE")
                Spacer()
                Text(targetName.uppercased())
                    .lineLimit(1)
            }
            .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
            .tracking(0.8)
            .foregroundStyle(ScoutInk.muted)

            GeometryReader { proxy in
                ZStack {
                    Rectangle()
                        .fill(ScoutSignalSurface.rule)
                        .frame(height: HudStrokeWidth.standard)

                    HStack {
                        ScoutHexagon()
                            .stroke(tint, lineWidth: 1.25)
                            .frame(width: 15, height: 17)
                        Spacer()
                        ScoutHexagon()
                            .stroke(tint, lineWidth: 1.25)
                            .frame(width: 15, height: 17)
                    }

                    Circle()
                        .fill(tint)
                        .frame(width: 7, height: 7)
                        .shadow(color: tint.opacity(0.34), radius: 5, y: 2)
                        .offset(x: reduceMotion ? 0 : (signalTravels ? proxy.size.width * 0.30 : -proxy.size.width * 0.30))

                    Image("ScoutWireMark")
                        .renderingMode(.template)
                        .resizable()
                        .scaledToFit()
                        .foregroundStyle(tint)
                        .frame(width: 32, height: 32)
                        .padding(7)
                        .background(Circle().fill(ScoutSignalSurface.top))
                }
            }
            .frame(height: 46)

            VStack(alignment: .leading, spacing: HudSpacing.xs) {
                Text("Authorizing device")
                    .font(HudFont.ui(HudTextSize.md, weight: .semibold))
                    .foregroundStyle(ScoutPalette.ink)

                Text(
                    isAwaitingApproval
                        ? "Approve this iPhone in Scout on \(targetName)."
                        : "Creating a private trust with \(targetName)…"
                )
                .font(HudFont.ui(HudTextSize.sm))
                .foregroundStyle(ScoutInk.muted)
                .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: HudSpacing.sm) {
                ProgressView()
                    .controlSize(.small)
                    .tint(tint)
                Text(isAwaitingApproval ? "WAITING FOR APPROVAL" : "ESTABLISHING TRUST")
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .tracking(0.9)
                    .foregroundStyle(tint)
            }
            .accessibilityElement(children: .combine)
        }
        .onAppear { updateSignalAnimation() }
        .onChange(of: isAwaitingApproval) { _, _ in updateSignalAnimation() }
        .onChange(of: reduceMotion) { _, _ in updateSignalAnimation() }
    }

    private func updateSignalAnimation() {
        signalTravels = false
        guard !reduceMotion else { return }
        withAnimation(.easeInOut(duration: isAwaitingApproval ? 1.3 : 0.9).repeatForever(autoreverses: true)) {
            signalTravels = true
        }
    }
}

private struct LocalScanTrace: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var scans = false

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Rectangle()
                    .fill(ScoutSignalSurface.rule)
                    .frame(height: HudStrokeWidth.standard)

                Capsule()
                    .fill(ScoutPalette.accent)
                    .frame(width: 54, height: 2)
                    .offset(x: reduceMotion ? max(0, proxy.size.width / 2 - 27) : (scans ? max(0, proxy.size.width - 54) : 0))
            }
        }
        .frame(height: 2)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 1.6).repeatForever(autoreverses: true)) {
                scans = true
            }
        }
        .accessibilityHidden(true)
    }
}

private struct SecondaryPairingButton: View {
    let title: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(title, systemImage: icon)
                .font(HudFont.ui(HudTextSize.sm, weight: .semibold))
                .foregroundStyle(ScoutPalette.ink)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(
                    RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                        .fill(ScoutSurface.inset)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                        .stroke(ScoutHairline.standard, lineWidth: HudStrokeWidth.thin)
                )
        }
        .buttonStyle(.plain)
    }
}

private struct NetworkSignInButtonLabel: View {
    enum Provider {
        case apple
        case github

        var title: String {
            switch self {
            case .apple: "Sign in with Apple"
            case .github: "Sign in with GitHub"
            }
        }
    }

    let provider: Provider

    var body: some View {
        HStack(spacing: 10) {
            providerIcon
                .frame(width: 18, height: 18)
            Text(provider.title)
                .font(.system(size: 17, weight: .medium))
        }
        .foregroundStyle(Color.black)
        .frame(maxWidth: .infinity)
        .frame(height: 44)
        .background(
            RoundedRectangle(cornerRadius: HudRadius.standard, style: .continuous)
                .fill(Color.white)
        )
    }

    @ViewBuilder private var providerIcon: some View {
        switch provider {
        case .apple:
            Image(systemName: "apple.logo")
                .font(.system(size: 17, weight: .medium))
        case .github:
            Image("GitHubMark")
                .resizable()
                .renderingMode(.template)
                .scaledToFit()
        }
    }
}

private struct OpenScoutNetworkPairTargetRow: View {
    let target: AppModel.OpenScoutNetworkPairTarget
    let isPairing: Bool
    let onPair: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: HudSpacing.sm) {
            HudStatusDot(color: ScoutPalette.accent, size: 7, pulses: true)
                .frame(width: 12)

            VStack(alignment: .leading, spacing: 2) {
                Text(target.displayName)
                    .font(HudFont.ui(HudTextSize.md))
                    .foregroundStyle(ScoutPalette.ink)
                    .lineLimit(1)
                Text(target.detail)
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutInk.dim)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }

            Spacer(minLength: HudSpacing.md)

            Button(action: onPair) {
                Text(isPairing ? "PAIRING" : "PAIR")
                    .font(HudFont.mono(HudTextSize.micro, weight: .semibold))
                    .tracking(0.8)
                    .foregroundStyle(ScoutPalette.accent)
                    .padding(.horizontal, HudSpacing.sm)
                    .padding(.vertical, HudSpacing.xxs)
                    .overlay(
                        Capsule()
                            .strokeBorder(HudSurface.tintBorder(ScoutPalette.accent), lineWidth: HudStrokeWidth.thin)
                    )
            }
            .buttonStyle(.plain)
            .disabled(isPairing)
        }
        .frame(minHeight: HudLayout.rowHeightRegular)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(ScoutHairline.subtle)
                .frame(height: HudStrokeWidth.thin)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(target.displayName), \(target.detail)")
        .accessibilityAddTraits(.isButton)
    }
}
