import SwiftUI

struct InboxView: View {
    @Environment(InboxStore.self) private var inbox
    @Environment(ConnectionManager.self) private var connection

    @State private var decisionPendingId: String?
    @State private var decisionError: String?
    @State private var decisionErrorItemId: String?
    @State private var isLoading = false

    private var isConnected: Bool {
        connection.state == .connected
    }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: ScoutSpacing.md) {
                Color.clear.frame(height: 24)

                headerCard
                    .padding(.horizontal, ScoutSpacing.lg)

                if isLoading && inbox.items.isEmpty {
                    loadingState
                        .padding(.top, ScoutSpacing.xl)
                } else if inbox.items.isEmpty {
                    emptyState
                        .padding(.top, ScoutSpacing.xl)
                } else {
                    ForEach(inbox.items) { item in
                        approvalCard(item)
                            .padding(.horizontal, ScoutSpacing.lg)
                    }
                }

                Color.clear.frame(height: 100)
            }
        }
        .background(ScoutColors.backgroundAdaptive)
        .refreshable {
            await refreshInbox()
        }
        .task {
            inbox.markInboxOpened()
            await refreshInbox()
        }
        .task(id: isConnected) {
            guard isConnected else { return }
            await refreshInbox()
        }
        .onAppear {
            inbox.markInboxOpened()
        }
        .onChange(of: inbox.unreadCount) { _, newValue in
            guard newValue > 0 else { return }
            inbox.markInboxOpened()
        }
    }

    private var headerCard: some View {
        HStack(spacing: ScoutSpacing.md) {
            Image(systemName: "tray.full")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(ScoutColors.textSecondary)
                .frame(width: 20)

            VStack(alignment: .leading, spacing: 2) {
                Text("INBOX")
                    .font(ScoutTypography.code(11, weight: .semibold))
                    .foregroundStyle(ScoutColors.textMuted)

                Text(headerSubtitle)
                    .font(ScoutTypography.code(12))
                    .foregroundStyle(ScoutColors.textSecondary)
            }

            Spacer()
        }
        .scoutCard()
    }

    private var headerSubtitle: String {
        if inbox.pendingCount == 0 {
            return isConnected
                ? "No approvals are waiting on you right now."
                : "Reconnect to refresh pending approvals."
        }

        if inbox.pendingCount == 1 {
            return "1 approval is waiting on you."
        }

        return "\(inbox.pendingCount) approvals are waiting on you."
    }

    private var loadingState: some View {
        VStack(spacing: ScoutSpacing.md) {
            ProgressView()
                .controlSize(.regular)
            Text("Loading approvals...")
                .font(ScoutTypography.body(14))
                .foregroundStyle(ScoutColors.textMuted)
        }
    }

    private var emptyState: some View {
        VStack(spacing: ScoutSpacing.md) {
            Text("CLEAR")
                .font(ScoutTypography.code(11, weight: .semibold))
                .foregroundStyle(ScoutColors.textMuted)

            Text(isConnected
                 ? "New approval requests will appear here."
                 : "Reconnect to refresh pending approvals.")
                .font(ScoutTypography.body(14))
                .foregroundStyle(ScoutColors.textSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, ScoutSpacing.xxl)
    }

    private func approvalCard(_ item: MobileInboxItem) -> some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.md) {
            HStack(alignment: .top, spacing: ScoutSpacing.sm) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.title)
                        .font(ScoutTypography.body(16, weight: .semibold))
                        .foregroundStyle(ScoutColors.textPrimary)

                    Text(item.sessionName)
                        .font(ScoutTypography.caption(12, weight: .medium))
                        .foregroundStyle(ScoutColors.textMuted)
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 4) {
                    Text(riskLabel(for: item.risk))
                        .font(ScoutTypography.caption(11, weight: .semibold))
                        .foregroundStyle(riskColor(for: item.risk))
                    Text(RelativeTime.string(from: item.createdDate))
                        .font(ScoutTypography.caption(11))
                        .foregroundStyle(ScoutColors.textMuted)
                }
            }

            Text(item.description)
                .font(ScoutTypography.body(14))
                .foregroundStyle(ScoutColors.textSecondary)

            if let detail = item.detail?.trimmedNonEmpty {
                Text(detail)
                    .font(ScoutTypography.code(12))
                    .foregroundStyle(ScoutColors.textPrimary)
                    .padding(ScoutSpacing.sm)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(ScoutColors.surfaceAdaptive)
                    .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.sm, style: .continuous))
            }

            if let decisionError, decisionPendingId == nil, decisionErrorItemId == item.id {
                Text(decisionError)
                    .font(ScoutTypography.caption(12, weight: .medium))
                    .foregroundStyle(ScoutColors.statusError)
            }

            HStack(spacing: ScoutSpacing.sm) {
                Button {
                    Task { await decide(item: item, decision: "approve") }
                } label: {
                    if decisionPendingId == "\(item.id):approve" {
                        ProgressView()
                            .controlSize(.mini)
                    } else {
                        Label("Approve", systemImage: "checkmark")
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(ScoutColors.statusActive)
                .disabled(decisionPendingId != nil || !isConnected)

                Button {
                    Task { await decide(item: item, decision: "deny") }
                } label: {
                    if decisionPendingId == "\(item.id):deny" {
                        ProgressView()
                            .controlSize(.mini)
                    } else {
                        Label("Deny", systemImage: "xmark")
                    }
                }
                .buttonStyle(.bordered)
                .disabled(decisionPendingId != nil || !isConnected)
            }
        }
        .scoutCard(padding: ScoutSpacing.lg, cornerRadius: ScoutRadius.lg)
    }

    @MainActor
    private func refreshInbox() async {
        guard isConnected else { return }
        isLoading = true
        defer { isLoading = false }
        await inbox.refresh(using: connection)
    }

    @MainActor
    private func decide(item: MobileInboxItem, decision: String) async {
        decisionPendingId = "\(item.id):\(decision)"
        decisionError = nil
        decisionErrorItemId = nil
        defer { decisionPendingId = nil }

        do {
            try await connection.decideAction(
                sessionId: item.sessionId,
                turnId: item.turnId,
                blockId: item.blockId,
                version: item.version,
                decision: decision
            )
            inbox.removeItem(id: item.id)
            await inbox.refresh(using: connection)
        } catch {
            decisionError = error.localizedDescription
            decisionErrorItemId = item.id
        }
    }

    private func riskLabel(for risk: ApprovalRisk) -> String {
        switch risk {
        case .low: return "Low risk"
        case .medium: return "Medium risk"
        case .high: return "High risk"
        }
    }

    private func riskColor(for risk: ApprovalRisk) -> Color {
        switch risk {
        case .low: return ScoutColors.statusActive
        case .medium: return ScoutColors.statusStreaming
        case .high: return ScoutColors.statusError
        }
    }
}
