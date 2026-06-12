import Foundation

/// Deterministic generative agent sprite — the native sibling of the web
/// generator (`packages/web/client/lib/agent-identity.ts`) and the studio
/// original. One name in → one stable little creature out, with no storage.
///
/// The hash + PRNG + cell layout are **bit-exact** with the TypeScript
/// version (verified against shared test vectors), so the same name yields
/// the same creature on web and on native. This is the richer sibling of
/// `ScoutAgentHue` — where that returned only a hue, this grows a face.
///
/// The mapping the system encodes:
///   - shape      ← the name   (the silhouette + eyes + traits)
///   - hue        ← the harness (`hue(forHarness:)`)
///   - brightness ← the state   (`tone(forState:)`)
///
/// Pure logic only (no SwiftUI) so it can live in ScoutAppCore and be used
/// by any target. Rendering is `SpriteAvatarView` in the Scout target.

public enum AgentSpriteCell: Sendable {
    case off, body, accent, eye, mouth
}

/// The "color range" knob — body lightness + chroma, driven by state.
/// Hue stays put; only how vivid/grey the creature reads changes.
public struct AgentSpriteTone: Sendable, Equatable {
    public var l: Double
    public var c: Double
    public init(l: Double = 0.72, c: Double = 0.15) {
        self.l = l
        self.c = c
    }
}

public struct AgentSprite: Sendable {
    public let size: Int
    public let cells: [[AgentSpriteCell]]
    public let hue: Int
    public let tone: AgentSpriteTone
}

// MARK: - PRNG (xmur3 + mulberry32), bit-exact with the JS port

private final class SpriteRng {
    private var a: UInt32
    let seed: UInt32

    init(_ key: String) {
        var h: UInt32 = 1779033703 ^ UInt32(key.utf16.count)
        for u in key.utf16 {
            h = (h ^ UInt32(u)) &* 3432918353
            h = (h << 13) | (h >> 19)
        }
        h = (h ^ (h >> 16)) &* 2246822507
        h = (h ^ (h >> 13)) &* 3266489909
        h ^= h >> 16
        self.seed = h
        self.a = h
    }

    func next() -> Double {
        a = a &+ 0x6D2B79F5
        var t = (a ^ (a >> 15)) &* (1 | a)
        t = (t &+ ((t ^ (t >> 7)) &* (61 | t))) ^ t
        return Double(t ^ (t >> 14)) / 4294967296.0
    }

    func float(_ lo: Double, _ hi: Double) -> Double { lo + (hi - lo) * next() }
    func bool(_ p: Double = 0.5) -> Bool { next() < p }
}

private func makeRng(_ key: String) -> SpriteRng {
    SpriteRng(key.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
}

// MARK: - Factory

public enum AgentSpriteFactory {
    /// Curated hue wheel — twelve well-separated stops so a whole fleet reads
    /// as one designed set. Kept identical to the web `CURATED_HUES`.
    public static let curatedHues: [Int] = [25, 45, 95, 125, 158, 188, 212, 238, 266, 292, 320, 345]

    private static let size = 7

    private static func pickHue(_ r: SpriteRng, spectrum: Bool) -> Int {
        let t = r.next()
        return spectrum ? Int(t * 360.0) : curatedHues[Int(t * Double(curatedHues.count))]
    }

    /// The raw 32-bit seed for a name — surfaced for diagnostics / "seed 0x…".
    public static func seed(forName name: String) -> UInt32 {
        makeRng(name).seed
    }

    /// Generate the sprite. `hue` forces the colour (harness-tint); `tone`
    /// sets the state-driven range; `salt` rerolls the silhouette.
    public static func sprite(
        name: String,
        salt: String? = nil,
        hue: Int? = nil,
        tone: AgentSpriteTone = AgentSpriteTone(),
        spectrum: Bool = false
    ) -> AgentSprite {
        let key = salt.map { "\(name)#\($0)" } ?? name
        let r = makeRng(key)
        let seededHue = pickHue(r, spectrum: spectrum)

        let density = r.float(0.42, 0.62)
        let speckle = r.float(0.14, 0.34)
        let antennae = r.bool(0.5)
        let legs = r.bool(0.62)
        let wideEyes = r.bool(0.5)
        let eyeRow = r.bool(0.5) ? 2 : 3
        let mouth = r.bool(0.6)

        let s = size
        let center = (s - 1) / 2
        var cells = Array(repeating: Array(repeating: AgentSpriteCell.off, count: s), count: s)

        func set(_ row: Int, _ col: Int, _ v: AgentSpriteCell) {
            cells[row][col] = v
            cells[row][s - 1 - col] = v
        }

        for row in 1...5 {
            for col in 0...center {
                let isSpine = col == center
                let lit = isSpine ? r.next() < 0.85 : r.next() < density
                if lit { set(row, col, r.next() < speckle ? .accent : .body) }
            }
        }

        for col in 1...center { set(eyeRow, col, .body) }
        set(eyeRow, wideEyes ? 1 : 2, .eye)

        if mouth && eyeRow + 2 < s {
            set(eyeRow + 2, center, .mouth)
            if r.bool(0.4) { set(eyeRow + 2, center - 1, .mouth) }
        }
        if antennae { set(0, r.bool() ? 1 : 2, .body) }
        if legs {
            set(s - 1, 1, .body)
            if r.bool(0.5) { set(s - 1, center, .body) }
        }

        return AgentSprite(size: s, cells: cells, hue: hue ?? seededHue, tone: tone)
    }

    // MARK: Mapping — hue ← harness, tone ← state

    /// Hue per harness family. Unknown harnesses return nil so the caller
    /// falls back to the name's curated hash. Kept in sync with the web
    /// `HARNESS_HUE` map.
    public static func hue(forHarness harness: String?) -> Int? {
        guard let key = harness?.trimmingCharacters(in: .whitespaces).lowercased(), !key.isEmpty else {
            return nil
        }
        switch key {
        case "claude": return 25
        case "codex": return 135
        case "cursor": return 235
        case "native": return 280
        case "worker": return 195
        case "pi": return 330
        default: return nil
        }
    }

    /// Brightness/chroma per state — working/needs-attention read alive,
    /// dormant states grey out.
    public static func tone(forState state: ScoutAgentState) -> AgentSpriteTone {
        switch state {
        case .working, .needsAttention: return AgentSpriteTone(l: 0.75, c: 0.16)
        case .available: return AgentSpriteTone(l: 0.73, c: 0.13)
        case .done: return AgentSpriteTone(l: 0.64, c: 0.075)
        case .offline: return AgentSpriteTone(l: 0.5, c: 0.02)
        }
    }
}
