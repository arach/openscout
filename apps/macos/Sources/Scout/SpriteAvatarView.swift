import ScoutAppCore
import SwiftUI

/// SpriteAvatarView — renders an `AgentSprite` (ScoutAppCore/AgentSprite.swift)
/// as a little pixel creature. Deterministic from the agent's name, color-
/// matched to the web client (same name → same creature).
///
///   shape      ← name      ·   hue        ← harness
///   brightness ← state
///
/// Colours are an HSB approximation of the studio's oklch palette, matching
/// the existing `HUDChrome.agentHue` convention so it sits next to the rest
/// of the native chrome. Drawn with Canvas for cheapness in dense lists.
struct SpriteAvatarView: View {
    private let sprite: AgentSprite
    private let size: CGFloat
    private let tile: Bool

    init(
        name: String,
        size: CGFloat,
        hue: Int? = nil,
        tone: AgentSpriteTone = AgentSpriteTone(),
        salt: String? = nil,
        tile: Bool = false
    ) {
        self.sprite = AgentSpriteFactory.sprite(name: name, salt: salt, hue: hue, tone: tone)
        self.size = size
        self.tile = tile
    }

    /// Convenience for a real agent — hue from harness, tone from state.
    init(agent: ScoutAgent, size: CGFloat, tile: Bool = true) {
        self.init(
            name: agent.displayName,
            size: size,
            hue: AgentSpriteFactory.hue(forHarness: agent.harness),
            tone: AgentSpriteFactory.tone(forState: agent.state),
            tile: tile
        )
    }

    var body: some View {
        let pad = tile ? size * 0.14 : 0
        ZStack {
            if tile {
                RoundedRectangle(cornerRadius: size * 0.26, style: .continuous)
                    .fill(bodyColor.opacity(0.14))
            }
            Canvas { ctx, csize in
                let s = sprite.size
                let cell = csize.width / CGFloat(s)
                let gap = cell * 0.07
                let radius = cell * 0.2
                for r in 0..<s {
                    for c in 0..<s {
                        let kind = sprite.cells[r][c]
                        if kind == .off { continue }
                        let rect = CGRect(
                            x: CGFloat(c) * cell + gap,
                            y: CGFloat(r) * cell + gap,
                            width: cell - gap * 2,
                            height: cell - gap * 2
                        )
                        let path = Path(roundedRect: rect, cornerRadius: radius)
                        switch kind {
                        case .eye:
                            ctx.fill(path, with: .color(scleraColor))
                            let pr = cell * 0.24
                            let pupil = Path(ellipseIn: CGRect(
                                x: CGFloat(c) * cell + cell / 2 - pr,
                                y: CGFloat(r) * cell + cell * 0.52 - pr,
                                width: pr * 2,
                                height: pr * 2
                            ))
                            ctx.fill(pupil, with: .color(inkColor))
                        case .accent:
                            ctx.fill(path, with: .color(accentColor))
                        case .mouth:
                            ctx.fill(path, with: .color(inkColor))
                        default:
                            ctx.fill(path, with: .color(bodyColor))
                        }
                    }
                }
            }
            .frame(width: size - pad * 2, height: size - pad * 2)
        }
        .frame(width: size, height: size)
    }

    // MARK: - Palette (HSB approximation of oklch)

    private func norm(_ h: Int) -> Double { Double(((h % 360) + 360) % 360) / 360.0 }
    private var bri: Double { min(0.92, 0.30 + sprite.tone.l * 0.72) }
    private var sat: Double { min(0.85, sprite.tone.c * 3.6) }

    private var bodyColor: Color {
        Color(hue: norm(sprite.hue), saturation: sat, brightness: bri)
    }
    private var accentColor: Color {
        Color(hue: norm(sprite.hue + 38), saturation: min(0.85, sat + 0.04), brightness: min(0.94, bri + 0.08))
    }
    private var inkColor: Color {
        Color(hue: norm(sprite.hue), saturation: 0.35, brightness: 0.34)
    }
    private var scleraColor: Color {
        Color(hue: norm(sprite.hue), saturation: 0.05, brightness: 0.97)
    }
}
