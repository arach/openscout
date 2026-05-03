import SwiftUI

struct OSNDiscoveryView: View {
    @Environment(ConnectionManager.self) private var connection

    @AppStorage("scout.tsn.enabled") private var tsnEnabled = true
    @AppStorage("scout.osn.enabled") private var osnEnabled = false
    @AppStorage("scout.osn.meshId") private var meshId = MeshRendezvousConfiguration.defaultMeshId
    @AppStorage("scout.osn.baseURL") private var baseURLString = MeshRendezvousConfiguration.defaultBaseURL.absoluteString
    @AppStorage("scout.osn.email") private var accountEmail = ""
    @AppStorage("scout.osn.githubLogin") private var githubLogin = ""

    @State private var nodes: [MeshRendezvousNode] = []
    @State private var isLoading = false
    @State private var isAuthenticating = false
    @State private var hasOSNSession = false
    @State private var connectingNodeId: String?
    @State private var errorMessage: String?

    private var configuration: MeshRendezvousConfiguration {
        MeshRendezvousConfiguration.current()
    }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: ScoutSpacing.lg) {
                statusCard
                accountCard

                if osnEnabled {
                    if !hasOSNSession {
                        messageCard(title: "Sign In Required", message: "Use GitHub to choose which OSN meshes this iPhone can access.", icon: "person.crop.circle.badge.exclamationmark")
                    } else if isLoading {
                        loadingCard
                    } else if let errorMessage {
                        messageCard(title: "OSN Unavailable", message: errorMessage, icon: "exclamationmark.triangle")
                    } else if nodes.isEmpty {
                        messageCard(title: "No Nodes", message: "No live OSN entries are available for \(meshId).", icon: "circle.dashed")
                    } else {
                        nodeList
                    }
                } else {
                    messageCard(title: "OSN Off", message: "Scout will not contact oscout.net.", icon: "cloud.slash")
                }
            }
            .padding(ScoutSpacing.lg)
        }
        .background(ScoutColors.backgroundAdaptive)
        .navigationTitle("OSN")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await refresh() }
                } label: {
                    if isLoading {
                        ProgressView()
                    } else {
                        Image(systemName: "arrow.clockwise")
                    }
                }
                .disabled(isLoading || !osnEnabled)
            }
        }
        .task(id: osnEnabled) {
            updateSessionState()
            guard osnEnabled else { return }
            await refresh()
        }
        .onAppear {
            updateSessionState()
        }
    }

    private var statusCard: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.md) {
            HStack(spacing: ScoutSpacing.md) {
                Image(systemName: "point.3.connected.trianglepath.dotted")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(ScoutColors.textMuted)
                    .frame(width: 24)

                VStack(alignment: .leading, spacing: 2) {
                    Text("OpenScout Network")
                        .font(ScoutTypography.code(13, weight: .semibold))
                        .foregroundStyle(ScoutColors.textPrimary)
                    Text("\(meshId) · \(displayHost)")
                        .font(ScoutTypography.code(11))
                        .foregroundStyle(ScoutColors.textSecondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }

                Spacer()

                Toggle("", isOn: $osnEnabled)
                    .labelsHidden()
                    .tint(ScoutColors.accent)
            }

            HStack(spacing: ScoutSpacing.sm) {
                RouteToken(label: "LAN", active: true)
                RouteToken(label: "TSN", active: tsnEnabled)
                RouteToken(label: "OSN", active: osnEnabled)
            }
        }
        .scoutCard(padding: ScoutSpacing.lg, cornerRadius: ScoutRadius.lg)
    }

    private var loadingCard: some View {
        HStack(spacing: ScoutSpacing.md) {
            ProgressView()
                .tint(ScoutColors.accent)
            Text("Reading OSN")
                .font(ScoutTypography.body(15, weight: .medium))
                .foregroundStyle(ScoutColors.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .scoutCard(padding: ScoutSpacing.lg, cornerRadius: ScoutRadius.lg)
    }

    private var accountCard: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.md) {
            HStack(spacing: ScoutSpacing.md) {
                Image(systemName: hasOSNSession ? "person.crop.circle.badge.checkmark" : "person.crop.circle.badge.plus")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(ScoutColors.textMuted)
                    .frame(width: 24)

                VStack(alignment: .leading, spacing: 2) {
                    Text(hasOSNSession ? accountTitle : "GitHub Sign In")
                        .font(ScoutTypography.body(15, weight: .semibold))
                        .foregroundStyle(ScoutColors.textPrimary)
                        .lineLimit(1)
                    Text(hasOSNSession ? accountSubtitle : "Required for OSN mesh membership")
                        .font(ScoutTypography.code(11))
                        .foregroundStyle(ScoutColors.textSecondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }

                Spacer()

                Button {
                    Task {
                        if hasOSNSession {
                            signOut()
                        } else {
                            await signIn()
                        }
                    }
                } label: {
                    if isAuthenticating {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Text(hasOSNSession ? "Sign Out" : "Sign In")
                            .font(ScoutTypography.code(11, weight: .semibold))
                    }
                }
                .buttonStyle(.bordered)
                .controlSize(.small)
                .disabled(isAuthenticating)
            }
        }
        .scoutCard(padding: ScoutSpacing.lg, cornerRadius: ScoutRadius.lg)
    }

    private var nodeList: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.sm) {
            ForEach(nodes) { node in
                OSNNodeRow(
                    node: node,
                    isConnecting: connectingNodeId == node.nodeId,
                    onConnect: {
                        Task { await connect(to: node) }
                    }
                )
            }
        }
    }

    private func messageCard(title: String, message: String, icon: String) -> some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.sm) {
            HStack(spacing: ScoutSpacing.sm) {
                Image(systemName: icon)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(ScoutColors.textMuted)
                Text(title)
                    .font(ScoutTypography.body(16, weight: .semibold))
                    .foregroundStyle(ScoutColors.textPrimary)
            }

            Text(message)
                .font(ScoutTypography.body(14))
                .foregroundStyle(ScoutColors.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .scoutCard(padding: ScoutSpacing.lg, cornerRadius: ScoutRadius.lg)
    }

    private func refresh() async {
        guard osnEnabled else { return }
        guard hasOSNSession else {
            errorMessage = "Sign in to OSN before reading mesh nodes."
            return
        }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            nodes = try await MeshRendezvousClient(configuration: configuration).fetchNodes()
        } catch {
            nodes = []
            errorMessage = error.localizedDescription
        }
    }

    private func connect(to node: MeshRendezvousNode) async {
        guard let payload = node.mobilePairingPayload else {
            errorMessage = "This OSN node is not publishing a mobile pairing route yet."
            return
        }

        connectingNodeId = node.nodeId
        errorMessage = nil
        defer { connectingNodeId = nil }

        do {
            try await connection.connect(qrPayload: payload)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func signIn() async {
        isAuthenticating = true
        errorMessage = nil
        defer { isAuthenticating = false }

        do {
            let baseURL = URL(string: baseURLString) ?? MeshRendezvousConfiguration.defaultBaseURL
            let authClient = OSNAuthClient()
            let result = try await authClient.signIn(baseURL: baseURL)
            hasOSNSession = true
            osnEnabled = true
            if let mesh = result.meshes.first {
                meshId = mesh.id
            }
            await refresh()
        } catch {
            hasOSNSession = (try? ScoutIdentity.loadOSNSessionToken()) != nil
            errorMessage = error.localizedDescription
        }
    }

    private func signOut() {
        do {
            let authClient = OSNAuthClient()
            try authClient.signOut()
            hasOSNSession = false
            osnEnabled = false
            nodes = []
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func updateSessionState() {
        hasOSNSession = (try? ScoutIdentity.loadOSNSessionToken()) != nil
    }

    private var displayHost: String {
        URL(string: baseURLString)?.host ?? baseURLString
    }

    private var accountTitle: String {
        if !githubLogin.isEmpty { return "@\(githubLogin)" }
        if !accountEmail.isEmpty { return accountEmail }
        return "Signed In"
    }

    private var accountSubtitle: String {
        accountEmail.isEmpty ? displayHost : accountEmail
    }
}

private struct OSNNodeRow: View {
    let node: MeshRendezvousNode
    let isConnecting: Bool
    let onConnect: () -> Void

    private var statusColor: Color {
        node.mobilePairingPayload == nil ? ScoutColors.textMuted : ScoutColors.ledAmber
    }

    private var canConnect: Bool {
        node.mobilePairingPayload != nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.sm) {
            HStack(spacing: ScoutSpacing.sm) {
                Circle()
                    .fill(statusColor)
                    .frame(width: 7, height: 7)

                Text(node.nodeName)
                    .font(ScoutTypography.body(15, weight: .semibold))
                    .foregroundStyle(ScoutColors.textPrimary)
                    .lineLimit(1)

                Spacer()

                Button {
                    onConnect()
                } label: {
                    if isConnecting {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Text(canConnect ? "Connect" : "No mobile")
                            .font(ScoutTypography.code(10, weight: .semibold))
                    }
                }
                .buttonStyle(.plain)
                .disabled(!canConnect || isConnecting)
                .foregroundStyle(canConnect ? ScoutColors.textPrimary : ScoutColors.textMuted)
            }

            Text(node.nodeId)
                .font(ScoutTypography.code(11))
                .foregroundStyle(ScoutColors.textSecondary)
                .lineLimit(1)
                .truncationMode(.middle)

            if !node.connectableURLs.isEmpty {
                ForEach(node.connectableURLs, id: \.absoluteString) { url in
                    Text(url.absoluteString)
                        .font(ScoutTypography.code(11))
                        .foregroundStyle(ScoutColors.textSecondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }

            if let payload = node.mobilePairingPayload {
                Text(payload.relay)
                    .font(ScoutTypography.code(11))
                    .foregroundStyle(ScoutColors.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .scoutCard(padding: ScoutSpacing.lg, cornerRadius: ScoutRadius.lg)
    }
}

private struct RouteToken: View {
    let label: String
    let active: Bool

    var body: some View {
        Text(label)
            .font(ScoutTypography.code(11, weight: .semibold))
            .foregroundStyle(active ? ScoutColors.textPrimary : ScoutColors.textMuted)
            .frame(minWidth: 44)
            .padding(.vertical, ScoutSpacing.xs)
            .background(active ? ScoutColors.textPrimary.opacity(0.08) : ScoutColors.surfaceAdaptive)
            .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.sm, style: .continuous))
    }
}
