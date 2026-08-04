import Testing
@testable import ScoutNativeCore

/// Cross-language vectors: generated from the TypeScript engine
/// (`packages/web/client/lib/agent-identity.ts` → `spriteFor` / `xmur3`) on
/// 2026-08-04. The same name must produce the same seed, the same curated hue
/// and the same 7×7 cell grid in every implementation — that identity is the
/// whole point of the sprite, and a silent divergence would give one agent two
/// faces depending on which surface you look at.
///
/// Fingerprint encoding: rows joined by "/", one char per cell —
/// o=off, b=body, a=accent, e=eye, m=mouth.
private struct Vector {
    let name: String
    let seed: UInt32
    let hue: Int
    let fingerprint: String
}

private let vectors: [Vector] = [
    Vector(
        name: "faraday-2",
        seed: 3_537_564_248,
        hue: 125,
        fingerprint: "ooboboo/bbobobb/bbbbbbb/bebbbeb/obbbbbo/obbbbbo/obobobo"
    ),
    Vector(
        name: "Blink",
        seed: 1_402_939_764,
        hue: 238,
        fingerprint: "obooobo/aboboba/oaoaoao/oebbbeo/aboaoba/obbmbbo/ooooooo"
    ),
    Vector(
        name: "epicurus-3",
        seed: 2_356_377_169,
        hue: 25,
        fingerprint: "ooboboo/bbbbbbb/bebbbeb/oooaooo/bbbmbbb/bobbbob/obooobo"
    ),
    Vector(
        name: "You",
        seed: 2_540_971_134,
        hue: 238,
        fingerprint: "ooooooo/aoobooa/obobobo/obebebo/oobaboo/oaoboao/ooooooo"
    ),
]

private func fingerprint(_ sprite: AgentSprite) -> String {
    sprite.cells
        .map { row in
            String(row.map { cell in
                switch cell {
                case .off: "o"
                case .body: "b"
                case .accent: "a"
                case .eye: "e"
                case .mouth: "m"
                }
            })
        }
        .joined(separator: "/")
}

@Test func spriteMatchesJavaScriptVectors() {
    for vector in vectors {
        #expect(AgentSpriteFactory.seed(forName: vector.name) == vector.seed, "seed drift for \(vector.name)")
        let sprite = AgentSpriteFactory.sprite(name: vector.name)
        #expect(sprite.hue == vector.hue, "hue drift for \(vector.name)")
        #expect(fingerprint(sprite) == vector.fingerprint, "cell drift for \(vector.name)")
    }
}

@Test func spriteIsCaseAndWhitespaceInsensitive() {
    // The rng key is trimmed + lowercased, so a display name that gains
    // padding or capitalization keeps its creature.
    #expect(AgentSpriteFactory.seed(forName: "  Faraday-2 ") == AgentSpriteFactory.seed(forName: "faraday-2"))
}

@Test func forcedHueOverridesTheSeededOne() {
    let tinted = AgentSpriteFactory.sprite(name: "faraday-2", hue: AgentSpriteFactory.hue(forHarness: "codex"))
    #expect(tinted.hue == 135)
    // Shape still comes from the name.
    #expect(fingerprint(tinted) == fingerprint(AgentSpriteFactory.sprite(name: "faraday-2")))
}
