import Observation
import SwiftUI

@MainActor
@Observable
final class ScoutSidebarTooltipState {
    static let shared = ScoutSidebarTooltipState()

    var label: String?
    var anchor: CGPoint = .zero

    private var dismissTask: Task<Void, Never>?

    private init() {}

    func show(label: String, anchor: CGPoint) {
        dismissTask?.cancel()
        self.label = label
        self.anchor = anchor
    }

    func update(anchor: CGPoint) {
        self.anchor = anchor
    }

    func dismiss(matching label: String) {
        dismissTask?.cancel()
        dismissTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(180))
            if self.label == label {
                self.label = nil
            }
        }
    }
}

struct ScoutSidebarTooltipOverlay: View {
    @State private var tooltipHeight: CGFloat = 0
    private var tooltip: ScoutSidebarTooltipState { .shared }

    var body: some View {
        GeometryReader { geo in
            if let label = tooltip.label {
                let overlayOrigin = geo.frame(in: .global).origin
                let localX = tooltip.anchor.x - overlayOrigin.x
                let localY = tooltip.anchor.y - overlayOrigin.y

                HStack(spacing: 0) {
                    ScoutSidebarTooltipArrow()
                        .fill(ScoutTheme.surfaceStrong)
                        .frame(width: 6, height: 10)

                    Text(label)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(ScoutTheme.ink)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(
                            RoundedRectangle(cornerRadius: 5)
                                .fill(ScoutTheme.surfaceStrong)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 5)
                                .strokeBorder(ScoutTheme.borderStrong, lineWidth: 1)
                        )
                }
                .fixedSize()
                .background {
                    GeometryReader { tipGeo in
                        Color.clear
                            .onAppear { tooltipHeight = tipGeo.size.height }
                            .onChange(of: tipGeo.size.height) { _, newHeight in
                                tooltipHeight = newHeight
                            }
                    }
                }
                .offset(x: localX, y: localY - tooltipHeight / 2)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .shadow(color: ScoutTheme.shadow, radius: 8, y: 4)
                .allowsHitTesting(false)
                .transition(.opacity)
            }
        }
    }
}

struct ScoutSidebarTooltipArrow: Shape {
    func path(in rect: CGRect) -> Path {
        Path { path in
            path.move(to: CGPoint(x: rect.maxX, y: rect.minY))
            path.addLine(to: CGPoint(x: rect.minX, y: rect.midY))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
            path.closeSubpath()
        }
    }
}
