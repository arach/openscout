import AppKit
import AVFoundation
import HudsonVoice
import ScoutSharedUI
import Speech
import SwiftUI

struct VoiceSettingsTab: View {
    @ObservedObject private var voice = ScoutVoiceService.shared
    @ObservedObject private var history = ScoutVoiceHistoryStore.shared

    @State private var devices: [ScoutVoiceInputDevice] = []
    @State private var selectedDeviceId: String = ""
    @State private var isWarming = false
    @State private var copiedDiagnostics = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            permissionBanner
            permissionsCard
            statusCard
            transcriptionCard
            inputCard
            troubleshootingCard
            historyCard
        }
        .task { await refresh() }
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            Task { await refresh() }
        }
        .onChange(of: voice.preference) { _, _ in
            devices = ScoutVoiceSettingsStore.listInputDevices()
            syncSelectedDevice()
        }
    }

    // MARK: - Permission banner

    private var permissionBanner: some View {
        let mic = ScoutVoicePermissions.microphoneStatus()
        let speech = ScoutVoicePermissions.speechRecognitionStatus()
        let ready = mic.granted && speech.granted

        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                Circle()
                    .fill(bannerColor(mic: mic, speech: speech, ready: ready))
                    .frame(width: 10, height: 10)

                VStack(alignment: .leading, spacing: 3) {
                    Text(bannerTitle(mic: mic, speech: speech, ready: ready))
                        .font(MenuType.mono(12, weight: .bold))
                        .foregroundStyle(ShellPalette.ink)

                    Text(bannerDetail(mic: mic, speech: speech, ready: ready))
                        .font(MenuType.body(11.5))
                        .foregroundStyle(ShellPalette.copy)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            HStack(spacing: 12) {
                bannerMeta("App", value: "Scout Menu")
                bannerMeta("Host", value: "Scout voice")
                bannerMeta("Mic", value: mic.granted ? "Granted" : mic.status.capitalized)
                bannerMeta("Speech", value: speech.granted ? "Granted" : speech.status.capitalized)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(bannerFill(mic: mic, ready: ready))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .stroke(bannerBorder(mic: mic, ready: ready), lineWidth: 1)
        )
    }

    private func bannerTitle(
        mic: ScoutVoicePermissionStatus,
        speech: ScoutVoicePermissionStatus,
        ready: Bool
    ) -> String {
        if ready { return voice.modelReady ? "DICTATION READY" : "DICTATION READY · MODEL WARMING" }
        if mic.isTerminal { return "MICROPHONE BLOCKED" }
        if mic.canRequest { return "MICROPHONE ACCESS NEEDED" }
        if !speech.granted { return "SPEECH RECOGNITION NEEDED" }
        return "VOICE PERMISSIONS NEEDED"
    }

    private func bannerDetail(
        mic: ScoutVoicePermissionStatus,
        speech: ScoutVoicePermissionStatus,
        ready: Bool
    ) -> String {
        if ready {
            return "Scout Menu owns microphone capture for web chat. The browser never records audio."
        }
        if mic.isTerminal {
            return mic.status == "restricted"
                ? "Microphone access is restricted on this Mac."
                : "Choose Retry access below. Scout will open the right macOS pane and detect the change."
        }
        if mic.canRequest {
            return "Click Request access to show the macOS permission dialog. Web chat dictation uses Scout Menu as the voice host."
        }
        if !speech.granted {
            return speech.canRequest
                ? "Click Request access to show the macOS Speech Recognition prompt."
                : "Open Privacy & Security → Speech Recognition to change it."
        }
        return "Finish the permissions below before using dictation in Scout Web."
    }

    private func bannerColor(
        mic: ScoutVoicePermissionStatus,
        speech: ScoutVoicePermissionStatus,
        ready: Bool
    ) -> Color {
        if ready { return ShellPalette.success }
        if mic.isTerminal { return ShellPalette.error }
        return ShellPalette.warning
    }

    private func bannerFill(mic: ScoutVoicePermissionStatus, ready: Bool) -> Color {
        if ready { return ShellPalette.accentSoft }
        if mic.isTerminal { return ShellPalette.errorSoft }
        return ShellPalette.cardMuted
    }

    private func bannerBorder(mic: ScoutVoicePermissionStatus, ready: Bool) -> Color {
        if ready { return ShellPalette.accentBorder }
        if mic.isTerminal { return ShellPalette.errorBorder }
        return ShellPalette.lineStrong
    }

    private func bannerMeta(_ label: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label.uppercased())
                .font(MenuType.mono(8, weight: .bold))
                .tracking(0.8)
                .foregroundStyle(ShellPalette.muted)
            Text(value)
                .font(MenuType.mono(10))
                .foregroundStyle(ShellPalette.copy)
        }
    }

    // MARK: - Status

    private var statusCard: some View {
        DiagnosticsCard(
            label: "Voice",
            status: voiceStatus(),
            summary: voiceSummary(),
            detail: voiceDetail(),
            rows: voiceRows(),
            logPath: nil,
            actions: [
                ("Refresh", { Task { await refresh() } }),
            ]
        )
    }

    private func voiceStatus() -> ServiceLightStatus {
        let mic = ScoutVoicePermissions.microphoneStatus()
        if !mic.granted { return mic.isTerminal ? .fail : .warn }
        if case .unavailable = voice.state { return .fail }
        if voice.preference != .apple && !voice.modelReady { return .warn }
        return .healthy
    }

    private func voiceSummary() -> String {
        let mic = ScoutVoicePermissions.microphoneStatus()
        if !mic.granted {
            return mic.isTerminal ? "Mic blocked" : "Mic needed"
        }
        if case .unavailable = voice.state { return "Unavailable" }
        if voice.preference != .apple && !voice.modelReady { return "Model warming" }
        return "Ready"
    }

    private func voiceDetail() -> String {
        var lines: [String] = []
        lines.append("Scout Menu owns microphone capture for web chat dictation. The browser does not record audio.")
        let mic = ScoutVoicePermissions.microphoneStatus()
        if !mic.granted {
            lines.append(ScoutVoicePermissions.microphoneStatusMessage(
                for: AVCaptureDevice.authorizationStatus(for: .audio)
            ))
        }
        if voice.preference != .apple && !voice.modelReady {
            lines.append("Parakeet is not warm yet. Apple Speech remains available as a fallback.")
        }
        return lines.joined(separator: "\n\n")
    }

    private func voiceRows() -> [KVEntry] {
        [
            KVEntry(key: "Engine", value: activeEngineLabel),
            KVEntry(key: "Preference", value: voice.preference.title),
            KVEntry(key: "Model", value: modelStatusLabel),
            KVEntry(key: "Warm", value: voice.preference == .apple ? "n/a" : (voice.modelReady ? "Yes" : "No")),
            KVEntry(key: "Last engine", value: lastEngineLabel(voice.lastEngine)),
            KVEntry(key: "Host", value: "scout-menu"),
        ]
    }

    // MARK: - Permissions

    private var permissionsCard: some View {
        SettingsCard {
            sectionHeader("Scout Menu permissions", symbol: "lock.shield")

            Text("Web dictation uses Scout Menu as the voice host. These permissions apply to Scout Menu — not your browser.")
                .font(MenuType.body(11))
                .foregroundStyle(ShellPalette.dim)
                .fixedSize(horizontal: false, vertical: true)

            permissionRow(
                title: "Microphone",
                status: ScoutVoicePermissions.microphoneStatus(),
                openSettings: ScoutVoicePermissions.openMicrophonePrivacySettings,
                request: { await ScoutVoicePermissions.recoverMicrophoneAccess() }
            )

            permissionRow(
                title: "Speech recognition",
                status: ScoutVoicePermissions.speechRecognitionStatus(),
                openSettings: ScoutVoicePermissions.openSpeechRecognitionPrivacySettings,
                request: { await ScoutVoicePermissions.recoverSpeechRecognitionAccess() }
            )
        }
    }

    private func permissionRow(
        title: String,
        status: ScoutVoicePermissionStatus,
        openSettings: @escaping () -> Void,
        request: @escaping () async -> Bool
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Circle()
                    .fill(status.granted ? ShellPalette.success : (status.isTerminal ? ShellPalette.error : ShellPalette.warning))
                    .frame(width: 7, height: 7)

                Text(title.uppercased())
                    .font(MenuType.mono(10, weight: .semibold))
                    .foregroundStyle(ShellPalette.ink)

                Text(status.displayStatus)
                    .font(MenuType.mono(11, weight: .semibold))
                    .foregroundStyle(status.granted ? ShellPalette.success : (status.isTerminal ? ShellPalette.error : ShellPalette.warning))

                Spacer()

                if !status.granted && !status.isUnavailable && status.status != "restricted" {
                    Button(status.canRequest ? "Request access" : "Retry access") {
                        Task {
                            _ = await request()
                            await refresh()
                        }
                    }
                    .buttonStyle(PrimaryPillStyle())
                }

                if !status.granted && !status.canRequest && !status.isUnavailable {
                    Button(settingsButtonTitle(for: status)) {
                        openSettings()
                    }
                    .buttonStyle(SecondaryPillStyle())
                }
            }

            if !status.granted {
                Text(permissionHint(for: status))
                    .font(MenuType.body(11))
                    .foregroundStyle(ShellPalette.dim)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(ShellPalette.surfaceFill)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .stroke(ShellPalette.line, lineWidth: 1)
        )
    }

    private func permissionHint(for status: ScoutVoicePermissionStatus) -> String {
        switch status.kind {
        case .microphone:
            return ScoutVoicePermissions.microphoneStatusMessage(
                for: AVCaptureDevice.authorizationStatus(for: .audio)
            )
        case .speechRecognition:
            return ScoutVoicePermissions.speechRecognitionStatusMessage(
                for: SFSpeechRecognizer.authorizationStatus()
            )
        }
    }

    private func settingsButtonTitle(for status: ScoutVoicePermissionStatus) -> String {
        switch status.kind {
        case .microphone:
            return "Open microphone settings"
        case .speechRecognition:
            return "Open speech settings"
        }
    }

    // MARK: - Transcription

    private var transcriptionCard: some View {
        SettingsCard {
            sectionHeader("Transcription", symbol: "waveform")

            Text("Parakeet on-device when warm; Apple Speech as instant fallback.")
                .font(MenuType.body(11))
                .foregroundStyle(ShellPalette.dim)
                .fixedSize(horizontal: false, vertical: true)

            HStack(spacing: 6) {
                ForEach(HudDictation.Preference.allCases, id: \.rawValue) { pref in
                    engineButton(pref)
                }
            }

            KVRow(entry: KVEntry(key: "Parakeet", value: modelStatusLabel))
            KVRow(entry: KVEntry(key: "Fallback", value: "Apple Speech"))

            if voice.preference != .apple && !voice.modelReady {
                HStack(spacing: 8) {
                    Spacer(minLength: 0)
                    Button(isWarming ? "Warming…" : "Download & warm") {
                        Task { await warmModel() }
                    }
                    .buttonStyle(PrimaryPillStyle())
                    .disabled(isWarming)
                }
            }
        }
    }

    private func engineButton(_ pref: HudDictation.Preference) -> some View {
        let active = voice.preference == pref
        return Button {
            voice.preference = pref
            Task { await refresh() }
        } label: {
            Text(pref.title.uppercased())
                .font(MenuType.mono(9, weight: active ? .bold : .medium))
                .tracking(0.6)
                .foregroundStyle(active ? ShellPalette.ink : ShellPalette.dim)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .fill(active ? ShellPalette.surfaceFillStrong : ShellPalette.surfaceFill)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .stroke(active ? ShellPalette.lineStrong : ShellPalette.line, lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
    }

    // MARK: - Input

    private var inputCard: some View {
        SettingsCard {
            sectionHeader("Microphone input", symbol: "mic")

            Text("Dictation follows the macOS system default input unless you pick a device here. Changing the selection stores your preference for when native capture routing is wired.")
                .font(MenuType.body(11))
                .foregroundStyle(ShellPalette.dim)
                .fixedSize(horizontal: false, vertical: true)

            if devices.isEmpty {
                KVRow(entry: KVEntry(key: "Devices", value: "No inputs detected"))
            } else {
                Picker("Input device", selection: $selectedDeviceId) {
                    ForEach(devices, id: \.id) { device in
                        Text(deviceLabel(device)).tag(device.id)
                    }
                }
                .labelsHidden()
                .pickerStyle(.menu)
                .onChange(of: selectedDeviceId) { _, newValue in
                    ScoutVoiceSettingsStore.saveInputDeviceId(newValue.isEmpty ? nil : newValue)
                    history.record(event: "settings.input", summary: "Input → \(deviceName(for: newValue))")
                }
            }

            HStack(spacing: 8) {
                Spacer(minLength: 0)
                Button("Open Sound Settings") {
                    if let url = URL(string: "x-apple.systempreferences:com.apple.preference.Sound") {
                        NSWorkspace.shared.open(url)
                    }
                }
                .buttonStyle(SecondaryPillStyle())
            }
        }
    }

    // MARK: - Troubleshooting

    private var troubleshootingCard: some View {
        SettingsCard {
            sectionHeader("Troubleshooting", symbol: "wrench.and.screwdriver")

            VStack(alignment: .leading, spacing: 8) {
                ForEach(troubleshootingTips, id: \.self) { tip in
                    HStack(alignment: .top, spacing: 8) {
                        Text("•")
                            .font(MenuType.mono(11, weight: .bold))
                            .foregroundStyle(ShellPalette.muted)
                        Text(tip)
                            .font(MenuType.body(11))
                            .foregroundStyle(ShellPalette.copy)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }

            HStack(spacing: 8) {
                Spacer(minLength: 0)
                Button(copiedDiagnostics ? "Copied" : "Copy diagnostics") {
                    copyDiagnostics()
                }
                .buttonStyle(SecondaryPillStyle())

                Button("Clear history") {
                    history.clear()
                }
                .buttonStyle(SecondaryPillStyle())
            }
        }
    }

    private var troubleshootingTips: [String] {
        var tips: [String] = [
            "Web chat dictation requires Scout Menu running with the web server reachable.",
            "If transcription hangs on “Processing”, wait up to 60 seconds or tap the mic again to cancel.",
        ]
        let mic = ScoutVoicePermissions.microphoneStatus()
        if mic.isTerminal {
            tips.insert(
                mic.status == "restricted"
                    ? "Microphone access is restricted on this Mac."
                    : "Microphone access is off for Scout Menu. Choose Retry access above to reopen the macOS permission pane.",
                at: 0
            )
        } else if mic.status == "notDetermined" {
            tips.insert("Tap Request access above or use the mic in chat to show the macOS microphone prompt.", at: 0)
        }
        if voice.preference != .apple && !voice.modelReady {
            tips.append("Use “Download & warm” or switch to Apple Speech for instant transcription while Parakeet loads.")
        }
        if case .unavailable(let reason) = voice.state {
            tips.insert(reason, at: 0)
        }
        return tips
    }

    // MARK: - History

    private var historyCard: some View {
        SettingsCard {
            sectionHeader("Session history", symbol: "clock.arrow.circlepath")

            if history.entries.isEmpty {
                Text("No dictation sessions recorded yet. History fills as you use the mic in web chat.")
                    .font(MenuType.body(11))
                    .foregroundStyle(ShellPalette.dim)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                VStack(spacing: 3) {
                    ForEach(history.recent(limit: 16)) { entry in
                        VoiceHistoryRow(entry: entry)
                    }
                }
                .padding(8)
                .background(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(ShellPalette.surfaceFill)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .stroke(ShellPalette.line, lineWidth: 1)
                )
            }
        }
    }

    // MARK: - Helpers

    private var activeEngineLabel: String {
        switch voice.preference {
        case .apple: return "Apple Speech"
        case .auto, .parakeet: return voice.modelReady ? "Parakeet" : "Apple Speech"
        }
    }

    private var modelStatusLabel: String {
        if voice.preference == .apple { return "Off (Apple only)" }
        if voice.modelReady { return "Ready" }
        if voice.modelInstalled { return "On disk" }
        return "Not downloaded"
    }

    private func sectionHeader(_ title: String, symbol: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(ShellPalette.muted)
            Text(title.uppercased())
                .font(MenuType.mono(10, weight: .bold))
                .tracking(0.8)
                .foregroundStyle(ShellPalette.muted)
            Spacer()
        }
    }

    private func deviceLabel(_ device: ScoutVoiceInputDevice) -> String {
        device.isDefault ? "\(device.name) (system default)" : device.name
    }

    private func deviceName(for id: String) -> String {
        devices.first(where: { $0.id == id })?.name ?? id
    }

    private func syncSelectedDevice() {
        let stored = ScoutVoiceSettingsStore.loadInputDeviceId()
        selectedDeviceId = stored
            ?? devices.first(where: { $0.isDefault })?.id
            ?? devices.first?.id
            ?? ""
    }

    private func refresh() async {
        devices = ScoutVoiceSettingsStore.listInputDevices()
        syncSelectedDevice()
        await voice.probe()
    }

    private func warmModel() async {
        isWarming = true
        history.record(event: "model.warm", summary: "Download & warm started")
        await voice.probe()
        isWarming = false
        history.record(
            event: "model.warm",
            summary: voice.modelReady ? "Parakeet ready" : "Parakeet still warming",
            level: voice.modelReady ? .success : .warn
        )
    }

    private func lastEngineLabel(_ engine: HudDictation.Engine) -> String {
        switch engine {
        case .parakeet: return "Parakeet"
        case .apple: return "Apple Speech"
        }
    }

    private func copyDiagnostics() {
        let mic = ScoutVoicePermissions.microphoneStatus()
        let speech = ScoutVoicePermissions.speechRecognitionStatus()
        let text = """
        Scout Voice Diagnostics
        Mic: \(mic.status) (granted=\(mic.granted))
        Speech: \(speech.status) (granted=\(speech.granted))
        Preference: \(voice.preference.rawValue)
        Active engine: \(activeEngineLabel)
        Model: \(modelStatusLabel)
        Input: \(deviceName(for: selectedDeviceId))
        State: \(String(describing: voice.state))

        Recent history:
        \(history.exportText())
        """
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        copiedDiagnostics = true
        Task {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            copiedDiagnostics = false
        }
    }
}

private struct VoiceHistoryRow: View {
    let entry: ScoutVoiceHistoryEntry

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(glyph)
                .font(MenuType.mono(10, weight: .bold))
                .foregroundStyle(tint)
                .frame(width: 10, alignment: .leading)

            Text(entry.ts.formatted(date: .omitted, time: .standard))
                .font(MenuType.mono(9))
                .foregroundStyle(ShellPalette.muted)
                .monospacedDigit()

            Text(entry.summary)
                .font(MenuType.mono(10))
                .foregroundStyle(ShellPalette.copy)
                .lineLimit(2)
                .truncationMode(.tail)
                .textSelection(.enabled)

            Spacer(minLength: 4)

            if let detail = entry.detail, !detail.isEmpty {
                Text(detail)
                    .font(MenuType.mono(9))
                    .foregroundStyle(ShellPalette.dim)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 2)
        .padding(.vertical, 2)
    }

    private var glyph: String {
        switch entry.level {
        case .info: return "·"
        case .success: return "✓"
        case .warn: return "!"
        case .error: return "×"
        }
    }

    private var tint: Color {
        switch entry.level {
        case .info: return ShellPalette.muted
        case .success: return ShellPalette.success
        case .warn: return ShellPalette.warning
        case .error: return ShellPalette.error
        }
    }
}
