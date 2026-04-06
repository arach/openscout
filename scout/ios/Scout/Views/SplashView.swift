// SplashView — Plays the scout-reveal video, then transitions out.
//
// Flash screen (system launch screen) → this splash → home screen.
// No extra text, no delays. Just the video on a matching dark bg.

import SwiftUI
import AVKit

struct SplashView: View {
    var onFinished: @MainActor @Sendable () -> Void

    var body: some View {
        ZStack {
            Color("LaunchBackground")
                .ignoresSafeArea()

            LogoRevealPlayer(onFinished: onFinished)
                .frame(width: 180, height: 210)
        }
    }
}

// MARK: - Video Player

private struct LogoRevealPlayer: UIViewRepresentable {
    var onFinished: @MainActor @Sendable () -> Void

    func makeUIView(context: Context) -> UIView {
        let container = UIView()
        container.backgroundColor = .clear

        guard let url = Bundle.main.url(forResource: "scout-reveal", withExtension: "mp4") else {
            // No video — skip splash immediately.
            let callback = onFinished
            DispatchQueue.main.async { callback() }
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
