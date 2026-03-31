// SettingsView — Debug, voice engine, and connection settings.

import SwiftUI

struct SettingsView: View {
    @Environment(ConnectionManager.self) private var connection
    @StateObject private var voice = DispatchVoice()

    var body: some View {
        NavigationStack {
            List {
                voiceSection
                connectionSection
                debugSection
            }
            .listStyle(.insetGrouped)
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
        }
    }

    // MARK: - Voice

    private var voiceSection: some View {
        Section {
            HStack {
                Label("Engine", systemImage: "waveform")
                Spacer()
                Text(engineName)
                    .foregroundStyle(DispatchColors.textSecondary)
            }

            HStack {
                Label("State", systemImage: "circle.fill")
                Spacer()
                Text(voiceStateName)
                    .foregroundStyle(voiceStateColor)
            }

            #if canImport(FluidAudio)
            HStack {
                Label("Parakeet Model", systemImage: "cpu")
                Spacer()
                Text(parakeetStatus)
                    .foregroundStyle(DispatchColors.textSecondary)
            }
            #endif

            HStack {
                Label("Last Used", systemImage: "clock")
                Spacer()
                Text(voice.lastEngine)
                    .foregroundStyle(DispatchColors.textSecondary)
            }
        } header: {
            Text("Voice")
        } footer: {
            #if canImport(FluidAudio)
            Text("Parakeet provides on-device AI transcription. Apple Speech is used as a fallback while the model loads (~90s).")
            #else
            Text("Using Apple Speech for on-device transcription. Add FluidAudio for Parakeet AI transcription.")
            #endif
        }
    }

    // MARK: - Connection

    private var connectionSection: some View {
        Section {
            HStack {
                Label("Status", systemImage: "antenna.radiowaves.left.and.right")
                Spacer()
                HStack(spacing: 6) {
                    Circle()
                        .fill(connectionColor)
                        .frame(width: 8, height: 8)
                    Text(connectionLabel)
                        .foregroundStyle(DispatchColors.textSecondary)
                }
            }

            if connection.hasTrustedBridge {
                HStack {
                    Label("Trusted Bridge", systemImage: "checkmark.shield")
                    Spacer()
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(DispatchColors.statusActive)
                }

                Button(role: .destructive) {
                    connection.clearTrustedBridge()
                } label: {
                    Label("Forget Bridge", systemImage: "trash")
                }
            }
        } header: {
            Text("Connection")
        }
    }

    // MARK: - Debug

    private var debugSection: some View {
        Section {
            NavigationLink {
                LogView()
            } label: {
                HStack {
                    Label("Logs", systemImage: "doc.text")
                    Spacer()
                    if logStore.errorCount > 0 {
                        Text("\(logStore.errorCount) errors")
                            .font(DispatchTypography.caption(12))
                            .foregroundStyle(DispatchColors.statusError)
                    } else {
                        Text("\(logStore.entries.count) entries")
                            .font(DispatchTypography.caption(12))
                            .foregroundStyle(DispatchColors.textMuted)
                    }
                }
            }

            HStack {
                Label("Build", systemImage: "hammer")
                Spacer()
                Text(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?")
                    .foregroundStyle(DispatchColors.textSecondary)
            }

            HStack {
                Label("Device", systemImage: "iphone")
                Spacer()
                Text(UIDevice.current.name)
                    .foregroundStyle(DispatchColors.textSecondary)
            }

            HStack {
                Label("iOS", systemImage: "gear")
                Spacer()
                Text(UIDevice.current.systemVersion)
                    .foregroundStyle(DispatchColors.textSecondary)
            }

            Button {
                UserDefaults.standard.set(false, forKey: "hasCompletedOnboarding")
            } label: {
                Label("Reset Onboarding", systemImage: "arrow.counterclockwise")
            }
        } header: {
            Text("Debug")
        }
    }

    @ObservedObject private var logStore = LogStore.shared

    // MARK: - Computed

    private var engineName: String {
        #if canImport(FluidAudio)
        "Parakeet + Apple Speech"
        #else
        "Apple Speech (on-device)"
        #endif
    }

    private var voiceStateName: String {
        switch voice.state {
        case .idle: "Idle"
        case .preparing: "Preparing..."
        case .ready: "Ready"
        case .recording: "Recording"
        case .transcribing: "Transcribing"
        case .error(let e): "Error: \(e)"
        }
    }

    private var voiceStateColor: Color {
        switch voice.state {
        case .ready: DispatchColors.statusActive
        case .recording: DispatchColors.statusError
        case .transcribing: DispatchColors.statusStreaming
        case .error: DispatchColors.statusError
        default: DispatchColors.textSecondary
        }
    }

    #if canImport(FluidAudio)
    private var parakeetStatus: String {
        switch ParakeetModelManager.shared.state {
        case .notDownloaded: "Not downloaded"
        case .downloading(let p): "Downloading \(Int(p * 100))%"
        case .downloaded: "Downloaded"
        case .loading: "Loading..."
        case .ready:
            ParakeetModelManager.shared.isWarmedUp ? "Ready" : "Warming up..."
        case .error(let e): "Error: \(e)"
        }
    }
    #endif

    private var connectionColor: Color {
        switch connection.state {
        case .connected: DispatchColors.statusActive
        case .connecting, .handshaking, .reconnecting: DispatchColors.statusStreaming
        case .disconnected: DispatchColors.statusIdle
        case .failed: DispatchColors.statusError
        }
    }

    private var connectionLabel: String {
        switch connection.state {
        case .connected: "Connected"
        case .connecting: "Connecting"
        case .handshaking: "Handshaking"
        case .reconnecting: "Reconnecting"
        case .disconnected: "Disconnected"
        case .failed: "Failed"
        }
    }
}
