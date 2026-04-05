// SplashView — Pre-splash wordmark, then logo reveal video.
//
// 1. Mono wordmark appears instantly on dark bg.
// 2. Logo reveal video fades in above the wordmark.
// 3. After the video ends, calls onFinished so the app can transition.

import SwiftUI
import AVKit

struct SplashView: View {
    var onFinished: () -> Void

    @State private var showVideo = false
    @State private var videoFinished = false

    var body: some View {
        ZStack {
            ScoutColors.backgroundAdaptive
                .ignoresSafeArea()

            VStack(spacing: 24) {
                if showVideo {
                    LogoRevealPlayer(onFinished: {
                        videoFinished = true
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                            onFinished()
                        }
                    })
                    .frame(width: 180, height: 210)
                    .transition(.opacity)
                }

                Text("scout")
                    .font(.system(size: 18, weight: .medium, design: .monospaced))
                    .foregroundStyle(ScoutColors.textSecondary)
                    .opacity(videoFinished ? 0 : 1)
            }
        }
        .task {
            try? await Task.sleep(for: .seconds(0.3))
            withAnimation(.easeIn(duration: 0.4)) {
                showVideo = true
            }
        }
    }
}

// MARK: - Video Player

private struct LogoRevealPlayer: UIViewRepresentable {
    var onFinished: @MainActor @Sendable () -> Void

    func makeUIView(context: Context) -> UIView {
        let container = UIView()
        container.backgroundColor = .clear

        guard let url = Bundle.main.url(forResource: "scout-logo-reveal", withExtension: "mp4") else {
            return container
        }

        let player = AVPlayer(url: url)
        player.isMuted = true

        let playerLayer = AVPlayerLayer(player: player)
        playerLayer.videoGravity = .resizeAspect
        playerLayer.backgroundColor = UIColor.clear.cgColor
        container.layer.addSublayer(playerLayer)

        context.coordinator.playerLayer = playerLayer
        context.coordinator.player = player

        NotificationCenter.default.addObserver(
            context.coordinator,
            selector: #selector(Coordinator.playerDidFinish),
            name: .AVPlayerItemDidPlayToEndTime,
            object: player.currentItem
        )

        player.play()

        return container
    }

    func updateUIView(_ uiView: UIView, context: Context) {
        context.coordinator.playerLayer?.frame = uiView.bounds
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(onFinished: onFinished)
    }

    class Coordinator: NSObject {
        var playerLayer: AVPlayerLayer?
        var player: AVPlayer?
        let onFinished: @MainActor @Sendable () -> Void

        init(onFinished: @MainActor @Sendable @escaping () -> Void) {
            self.onFinished = onFinished
        }

        @objc func playerDidFinish() {
            let callback = onFinished
            Task { @MainActor in callback() }
        }
    }
}
