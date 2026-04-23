import SwiftUI

struct AgentDashboardView: View {
    let agentId: String

    @Environment(ConnectionManager.self) private var connection
    @Environment(ScoutRouter.self) private var router

    @State private var detail: MobileAgentDetail?
    @State private var isLoading = true

    var body: some View {
        ZStack(alignment: .bottom) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    headerSection
                    statGrid
                        .padding(.horizontal, ScoutSpacing.lg)
                        .padding(.top, ScoutSpacing.xl)
                    activitySection
                        .padding(.top, ScoutSpacing.xxl)
                    terminalSection
                        .padding(.top, ScoutSpacing.xxl)
                    // Clearance for floating CTA + action tray (~100pt bar + spacing)
                    Color.clear.frame(height: 160)
                }
            }
            .background(ScoutColors.pageBg)

            if let sessionId = detail?.sessionId {
                // 100pt clears the ScoutBottomBar (70pt center button + padding + safe area)
                takeOverButton(sessionId: sessionId)
                    .padding(.horizontal, ScoutSpacing.lg)
                    .padding(.bottom, 100)
                    .background(
                        LinearGradient(
                            colors: [ScoutColors.pageBg.opacity(0), ScoutColors.pageBg],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                        .ignoresSafeArea()
                    )
            }
        }
        .background(ScoutColors.pageBg)
        .task { await loadDetail() }
    }

    // MARK: - Header

    private var ledColor: Color {
        switch detail?.state {
        case "working":   return ScoutColors.ledGreen
        case "available": return ScoutColors.ledAmber
        default:          return ScoutColors.textMuted
        }
    }

    private var statusSubtitle: String {
        let status: String
        switch detail?.state {
        case "working":   status = "Running"
        case "available": status = "Ready"
        default:          status = "Offline"
        }
        if let model = detail?.model?.trimmedNonEmpty ?? detail?.harness?.trimmedNonEmpty {
            return "\(status) · \(model)"
        }
        return status
    }

    private var headerSection: some View {
        HStack(alignment: .top, spacing: ScoutSpacing.md) {
            Circle()
                .fill(ledColor)
                .frame(width: 8, height: 8)
                .padding(.top, 6)

            VStack(alignment: .leading, spacing: 3) {
                Text(detail?.title ?? "Agent")
                    .font(ScoutTypography.body(20, weight: .semibold))
                    .foregroundStyle(ScoutColors.textPrimary)
                Text(statusSubtitle)
                    .font(ScoutTypography.code(11))
                    .foregroundStyle(ScoutColors.textMuted)
                    .contentTransition(.opacity)
                    .animation(.easeInOut(duration: 0.2), value: statusSubtitle)
            }

            Spacer()

            Button(action: { router.pop() }) {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(ScoutColors.textMuted)
                    .frame(width: 26, height: 26)
                    .background(ScoutColors.cardBg)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(ScoutColors.divider.opacity(0.5), lineWidth: 0.5))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, ScoutSpacing.lg)
        .padding(.top, ScoutSpacing.xl)
    }

    // MARK: - Stat Cards

    private var statGrid: some View {
        let columns = [
            GridItem(.flexible(), spacing: ScoutSpacing.sm),
            GridItem(.flexible(), spacing: ScoutSpacing.sm),
            GridItem(.flexible(), spacing: ScoutSpacing.sm),
        ]
        return LazyVGrid(columns: columns, spacing: ScoutSpacing.sm) {
            statCard(value: detail.map { "\($0.messageCount)" } ?? "--", label: "MESSAGES")
            statCard(value: detail.map { "\($0.activeFlights.count)" } ?? "--", label: "TASKS")
            statCard(value: detail.map { "\($0.recentActivity.count)" } ?? "--", label: "EVENTS")
        }
    }

    private func statCard(value: String, label: String) -> some View {
        VStack(alignment: .center, spacing: 4) {
            Text(value)
                .font(ScoutTypography.code(22, weight: .semibold))
                .foregroundStyle(ScoutColors.textPrimary)
                .monospacedDigit()
            Text(label)
                .font(ScoutTypography.code(8, weight: .semibold))
                .foregroundStyle(ScoutColors.textMuted)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, ScoutSpacing.lg)
        .background(ScoutColors.cardBg)
        .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous)
                .stroke(ScoutColors.divider.opacity(0.6), lineWidth: 0.5)
        )
    }

    // MARK: - Activity Feed

    private var activitySection: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.md) {
            Text("ACTIVITY")
                .font(ScoutTypography.code(9, weight: .semibold))
                .foregroundStyle(ScoutColors.textMuted)
                .padding(.horizontal, ScoutSpacing.lg)

            if isLoading {
                HStack(spacing: ScoutSpacing.sm) {
                    ProgressView().controlSize(.small)
                    Text("Loading...")
                        .font(ScoutTypography.code(11))
                        .foregroundStyle(ScoutColors.textMuted)
                }
                .padding(.horizontal, ScoutSpacing.lg)
            } else if let items = detail?.recentActivity, !items.isEmpty {
                let displayItems = Array(items.suffix(8).reversed())
                VStack(spacing: 0) {
                    ForEach(Array(displayItems.enumerated()), id: \.element.id) { index, item in
                        activityRow(item)
                        if index < displayItems.count - 1 {
                            Rectangle()
                                .fill(ScoutColors.divider.opacity(0.4))
                                .frame(height: 0.5)
                                .padding(.leading, ScoutSpacing.lg + 20 + ScoutSpacing.md)
                        }
                    }
                }
            } else {
                Text("No recent activity")
                    .font(ScoutTypography.code(11))
                    .foregroundStyle(ScoutColors.textMuted)
                    .padding(.horizontal, ScoutSpacing.lg)
            }
        }
    }

    private func activityRow(_ item: ActivityItem) -> some View {
        HStack(alignment: .top, spacing: ScoutSpacing.md) {
            Image(systemName: "waveform.path.ecg")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(ScoutColors.textMuted)
                .frame(width: 20)
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: 2) {
                Text(item.summary ?? item.kind)
                    .font(ScoutTypography.code(12))
                    .foregroundStyle(ScoutColors.activityGreen)
                    .lineLimit(1)

                Text(RelativeTime.string(from: item.date))
                    .font(ScoutTypography.code(10))
                    .foregroundStyle(ScoutColors.textMuted)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, ScoutSpacing.lg)
        .padding(.vertical, ScoutSpacing.md)
    }

    // MARK: - Terminal Block

    private var terminalSection: some View {
        VStack(alignment: .leading, spacing: ScoutSpacing.md) {
            Text("TERMINAL")
                .font(ScoutTypography.code(9, weight: .semibold))
                .foregroundStyle(ScoutColors.textMuted)
                .padding(.horizontal, ScoutSpacing.lg)

            VStack(alignment: .leading, spacing: ScoutSpacing.sm) {
                terminalPrompt("session://\(sessionLocation)")
                terminalCommand("agent init\(modelFlag)")
                terminalOutput("Session initialized")
                if let harness = detail?.harness?.trimmedNonEmpty {
                    terminalCommand("connect \(harness)")
                    terminalOutput("Connected")
                }
                Text("_")
                    .font(ScoutTypography.code(12))
                    .foregroundStyle(ScoutColors.textMuted)
                    .opacity(0.6)
            }
            .padding(ScoutSpacing.md)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(white: 0.03))
            .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: ScoutRadius.md, style: .continuous)
                    .stroke(ScoutColors.divider.opacity(0.4), lineWidth: 0.5)
            )
            .padding(.horizontal, ScoutSpacing.lg)
        }
    }

    private var sessionLocation: String {
        if let root = detail?.cwd?.trimmedNonEmpty {
            return URL(fileURLWithPath: root).lastPathComponent
        }
        return "local"
    }

    private var modelFlag: String {
        if let m = detail?.model?.trimmedNonEmpty ?? detail?.harness?.trimmedNonEmpty {
            return " --model \(m)"
        }
        return ""
    }

    private func terminalPrompt(_ text: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: "chevron.right")
                .font(.system(size: 9, weight: .medium))
                .foregroundStyle(ScoutColors.textMuted)
            Text(text)
                .font(ScoutTypography.code(11))
                .foregroundStyle(ScoutColors.textMuted)
        }
    }

    private func terminalCommand(_ cmd: String) -> some View {
        Text("$ \(cmd)")
            .font(ScoutTypography.code(11))
            .foregroundStyle(ScoutColors.textSecondary)
    }

    private func terminalOutput(_ out: String) -> some View {
        Text("> \(out)")
            .font(ScoutTypography.code(11))
            .foregroundStyle(ScoutColors.activityGreen)
    }

    // MARK: - Take Over Button

    private func takeOverButton(sessionId: String) -> some View {
        Button {
            router.push(.sessionDetail(sessionId: sessionId))
        } label: {
            Text("Launch Session")
                .font(ScoutTypography.body(15, weight: .semibold))
                .foregroundStyle(ScoutColors.ledGreen.opacity(0.9))
                .frame(maxWidth: .infinity)
                .padding(.vertical, ScoutSpacing.xl)
                .background(Color(white: 0.06))
                .clipShape(RoundedRectangle(cornerRadius: ScoutRadius.lg, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: ScoutRadius.lg, style: .continuous)
                        .stroke(ScoutColors.ledGreen.opacity(0.25), lineWidth: 0.75)
                )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Load

    private func loadDetail() async {
        isLoading = true
        do {
            detail = try await connection.getAgentDetail(agentId: agentId)
        } catch {}
        isLoading = false
    }
}
