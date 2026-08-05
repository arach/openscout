import HudsonUI
import ScoutNativeCore
import SwiftUI

/// SpriteAvatarView — renders an `AgentSprite` (ScoutNativeCore/AgentSprite.swift)
/// as a little pixel creature. Deterministic from the agent's name and colour-
/// matched to the web client and macOS: same name → same creature everywhere.
///
///   shape ← name · hue ← name (curated wheel, or forced) · brightness ← tone
///
/// Colours are an HSB approximation of the studio's oklch palette, matching the
/// macOS `SpriteAvatarView` convention. Drawn with Canvas so a long feed stays
/// cheap.
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

/// A sprite wearing its runtime: the harness mark rides the creature's
/// bottom-right corner, overlapping the tile so it reads as a property OF this
/// agent rather than a separate chip beside it. The mark sits on a
/// background-filled disc so it stays legible over whatever pixels it covers.
///
/// No harness → no badge. The phone cannot resolve a runtime for every agent,
/// and a placeholder glyph would be a claim we can't back.
struct SpriteIdentityMark: View {
    let name: String
    var harness: String?
    var size: CGFloat = 34
    var tone: AgentSpriteTone = AgentSpriteTone()

    private var badgeSize: CGFloat { max(13, size * 0.44) }

    var body: some View {
        SpriteAvatarView(name: name, size: size, tone: tone, tile: true)
            .overlay(alignment: .bottomTrailing) {
                if let harness, HarnessMark.identifies(harness) {
                    HarnessMark(harness: harness, size: badgeSize * 0.60)
                        .foregroundStyle(ScoutPalette.ink)
                        .frame(width: badgeSize, height: badgeSize)
                        .background(
                            Circle()
                                .fill(ScoutPalette.bg)
                                .overlay(Circle().stroke(ScoutHairline.standard, lineWidth: HudStrokeWidth.thin))
                        )
                        // Sit ON the creature: most of the badge overlaps the
                        // tile, only its outer quarter breaks the corner — so it
                        // reads as applied to this agent, not parked beside it.
                        .offset(x: badgeSize * 0.24, y: badgeSize * 0.24)
                }
            }
            .accessibilityLabel(harness.map { "\(name), \($0)" } ?? name)
    }
}
