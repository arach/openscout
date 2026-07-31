// RuntimePicker — harness · model · effort as ONE control, and the panel that
// opens out of it. The SwiftUI port of the studio's RuntimePicker (rail
// variant: design/studio/components/RuntimePicker.tsx), optimized for a phone.
//
// The resting shape is `ScoutRuntimeChip` (ComposerKit): `✳ Opus 5 | AUTO ⌄`.
// Tapping it does NOT replace the composer with a sheet — the chip stays exactly
// where it is and the panel GROWS out of it, upward, over a light scrim that
// keeps the draft you were writing visible behind it. That is the whole point:
// you are changing a setting on the message in front of you, not leaving to a
// modal and coming back.
//
//   ╭ panel ─────────────────────────────────╮
//   │ ▌Claude │ ● Opus   5        DEFAULT    │  rail · one travelling marker
//   │  Codex  │   Sonnet 4.6                 │  models · beside the rail
//   │         │   Fable  alpha               │
//   ├────────────────────────────────────────┤
//   │  AUTO      LOW      MEDIUM      HIGH   │  effort · ordinal footer ladder
//   ╰────────────────────────────────────────╯
//                              ▲ grows from the chip, which stays lit below
//
// Mobile grammar the studio panel doesn't have to answer for:
//   · The ladder is the FOOTER, so on an upward-opening panel it lands nearest
//     the thumb that just tapped the chip — the setting you retune most often
//     is the one you can reach without moving your hand.
//   · Every row is 44pt.
//   · The panel is clamped to the screen and to the room above the chip, so a
//     raised keyboard shortens it rather than hiding it.
//
// Picks COMMIT LIVE. The old sheet carried a draft, a running summary and a
// Done button because it had covered up the thing it was describing; anchored,
// the chip below IS the summary and it updates under your finger, so both the
// summary row and the commit button answer a question that no longer gets
// asked. Ways out: scrim tap, swipe down, or tap the chip again.
//
// The catalog mirrors the real `--model` values the surface passes to the CLI —
// only harnesses the app actually supports ship here; new harnesses slot in by
// appending to `ComposerModelHarness.catalog`.

import SwiftUI
import HudsonUI
import ScoutCapabilities
#if canImport(UIKit)
import UIKit
#endif

// MARK: - Catalog

/// One selectable model family — a single flat pick (no separate version row).
/// `value` is the string passed verbatim to the CLI as `--model`; nil means
/// "harness decides" and is only used for machine-reported harnesses we don't
/// curate models for.
struct ComposerModelFamily: Identifiable, Hashable {
    let id: String          // selection id — the --model value, or "auto"
    let label: String       // bold family name, e.g. "Opus"
    let sublabel: String    // dim version, e.g. "5"
    let value: String?
    let isDefault: Bool

    /// Token/summary rendering, e.g. "Opus 5" or "5.6 sol".
    var displayName: String { sublabel.isEmpty ? label : "\(label) \(sublabel)" }
}

/// One harness on the rail: its mark, a one-word label, and its hand-picked
/// family list with exactly ONE default (pre-selected, tagged DEFAULT).
struct ComposerModelHarness: Identifiable, Hashable {
    let id: String          // spec `execution.harness`, e.g. "claude"
    let label: String       // full label, e.g. "Claude Code" (results, menus)
    let short: String       // one-word rail label, e.g. "Claude"
    let monogram: String    // typographic stand-in for surfaces that render the
                            // harness as a character rather than a brand mark
                            // (Home's terminal rows); the panel uses HarnessMark
    let families: [ComposerModelFamily]

    var defaultFamily: ComposerModelFamily {
        families.first(where: \.isDefault) ?? families[0]
    }

    static let catalog: [ComposerModelHarness] = [
        ComposerModelHarness(id: "claude", label: "Claude Code", short: "Claude", monogram: "✳", families: [
            ComposerModelFamily(id: "claude-opus-5", label: "Opus", sublabel: "5", value: "claude-opus-5", isDefault: true),
            ComposerModelFamily(id: "claude-sonnet-4-6", label: "Sonnet", sublabel: "4.6", value: "claude-sonnet-4-6", isDefault: false),
            ComposerModelFamily(id: "fable", label: "Fable", sublabel: "alpha", value: "fable", isDefault: false),
        ]),
        ComposerModelHarness(id: "codex", label: "Codex", short: "Codex", monogram: "◈", families: [
            ComposerModelFamily(id: "gpt-5.6-sol", label: "5.6", sublabel: "sol", value: "gpt-5.6-sol", isDefault: true),
            ComposerModelFamily(id: "gpt-5.6-terra", label: "5.6", sublabel: "terra", value: "gpt-5.6-terra", isDefault: false),
            ComposerModelFamily(id: "gpt-5.6-luna", label: "5.6", sublabel: "luna", value: "gpt-5.6-luna", isDefault: false),
            ComposerModelFamily(id: "gpt-5.5-mini", label: "5.5", sublabel: "mini", value: "gpt-5.5-mini", isDefault: false),
        ]),
        ComposerModelHarness(id: "grok", label: "Grok", short: "Grok", monogram: "✕", families: [
            ComposerModelFamily(id: "grok-4.5", label: "Grok", sublabel: "4.5", value: "grok-4.5", isDefault: true),
            ComposerModelFamily(id: "grok-4.3", label: "Grok", sublabel: "4.3", value: "grok-4.3", isDefault: false),
        ]),
        // Kimi ships no curated model ids we can verify; Auto omits `--model`
        // so the harness picks its own. Observed models arrive via the fetched
        // catalog (C.5), not this seed.
        ComposerModelHarness(id: "kimi", label: "Kimi", short: "Kimi", monogram: "◐", families: [
            ComposerModelFamily(id: "auto", label: "Auto", sublabel: "", value: nil, isDefault: true),
        ]),
    ]

    static func curated(_ id: String) -> ComposerModelHarness? {
        catalog.first { $0.id == id }
    }

    /// A rail entry for a machine-reported harness we don't curate models for:
    /// one Auto family that omits `--model` so the harness picks its own.
    static func fallback(id: String, label: String) -> ComposerModelHarness {
        ComposerModelHarness(
            id: id,
            label: label,
            short: label,
            monogram: id.prefix(1).uppercased(),
            families: [ComposerModelFamily(id: "auto", label: "Auto", sublabel: "", value: nil, isDefault: true)]
        )
    }
}

extension RuntimeCapabilityCatalog {
    var composerHarnesses: [ComposerModelHarness] {
        harnesses.map { harness in
            let choices = models.filter { $0.harnesses.contains(harness.id) }.map { model in
                ComposerModelFamily(
                    id: model.id,
                    label: model.label,
                    sublabel: "",
                    value: model.id,
                    isDefault: false
                )
            }
            let seededDefault = ComposerModelHarness.curated(harness.id)?.defaultFamily.id
            let normalized = choices.enumerated().map { index, choice in
                ComposerModelFamily(
                    id: choice.id,
                    label: choice.label,
                    sublabel: choice.sublabel,
                    value: choice.value,
                    isDefault: choice.id == seededDefault || (seededDefault == nil && index == 0)
                )
            }
            return ComposerModelHarness(
                id: harness.id,
                label: harness.label,
                short: harness.label.split(separator: " ").first.map(String.init) ?? harness.id,
                monogram: ComposerModelHarness.curated(harness.id)?.monogram
                    ?? harness.id.prefix(1).uppercased(),
                families: normalized.isEmpty
                    ? [ComposerModelFamily(id: "auto", label: "Auto", sublabel: "", value: nil, isDefault: true)]
                    : normalized
            )
        }
    }

    var composerEfforts: [ComposerEffortOption] {
        [ComposerEffortOption(id: ComposerEffortOption.defaultId, label: "Auto", value: nil, harnesses: [])]
            + efforts.map { effort in
                ComposerEffortOption(
                    id: effort.id,
                    label: effort.label,
                    value: effort.id,
                    harnesses: Set(effort.harnesses),
                    models: effort.models.map { Set($0) }
                )
            }
    }
}

enum ComposerRuntimeCatalogCache {
    private static let key = "scout.runtime-capabilities.v1"

    static func load() -> RuntimeCapabilityCatalog? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(RuntimeCapabilityCatalog.self, from: data)
    }

    static func save(_ catalog: RuntimeCapabilityCatalog) {
        guard let data = try? JSONEncoder().encode(catalog) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }
}

/// One reasoning-effort stop. `value` is the spec's `execution.reasoningEffort`;
/// nil for Auto — the field is omitted and the harness decides.
struct ComposerEffortOption: Identifiable, Hashable {
    let id: String
    let label: String
    let value: String?
    let harnesses: Set<String>
    // `var` + default: the memberwise init both accepts it (the fetched-catalog
    // bridge passes per-model effort scoping) and lets the seed rows omit it.
    var models: Set<String>? = nil

    static let defaultId = "auto"
    static let catalog: [ComposerEffortOption] = [
        ComposerEffortOption(id: defaultId, label: "Auto", value: nil, harnesses: []),
        ComposerEffortOption(id: "none", label: "None", value: "none", harnesses: ["codex"]),
        ComposerEffortOption(id: "minimal", label: "Minimal", value: "minimal", harnesses: ["codex"]),
        ComposerEffortOption(id: "low", label: "Low", value: "low", harnesses: ["claude", "codex"]),
        ComposerEffortOption(id: "medium", label: "Medium", value: "medium", harnesses: ["claude", "codex"]),
        ComposerEffortOption(id: "high", label: "High", value: "high", harnesses: ["claude", "codex"]),
        ComposerEffortOption(id: "xhigh", label: "XHigh", value: "xhigh", harnesses: ["claude", "codex"]),
        ComposerEffortOption(id: "max", label: "Max", value: "max", harnesses: ["claude", "codex"]),
        ComposerEffortOption(id: "ultra", label: "Ultra", value: "ultra", harnesses: ["codex"]),
    ]
}

// MARK: - Study palette
//
// The machined-graphite values the picker study shipped with, still worn by the
// New surface's model token and by Home's inset wells. The panel itself is now
// built on the shared tokens (`ScoutMachinedPlate`, `HudPalette`, `ScoutInk`) so
// it reads as the same instrument family as the masthead complications and the
// glass bar's seat — and so it holds up under every canvas tone.

enum ModelPickerTone {
    static let ink = Color(red: 242.0/255, green: 244.0/255, blue: 239.0/255)          // #f2f4ef
    static let muted = Color(red: 170.0/255, green: 177.0/255, blue: 167.0/255)        // #aab1a7
    static let dim = Color(red: 119.0/255, green: 126.0/255, blue: 117.0/255)          // #777e75
    static let faint = Color(red: 76.0/255, green: 85.0/255, blue: 78.0/255)           // #4c554e
    static let accent = Color(red: 166.0/255, green: 239.0/255, blue: 135.0/255)       // #a6ef87
    static let accentDim = accent.opacity(0.5)
    static let accentSoft = accent.opacity(0.09)
    static let scrim = Color(red: 3.0/255, green: 4.0/255, blue: 3.0/255).opacity(0.5) // rgba(3,4,3,.5)
    static let chipFill = Color(red: 11.0/255, green: 14.0/255, blue: 12.0/255)        // #0b0e0c
    static let insetFill = Color(red: 7.0/255, green: 9.0/255, blue: 7.0/255)          // #070907
    static let insetEdge = Color(red: 24.0/255, green: 29.0/255, blue: 25.0/255)       // #181d19
    static let tokenEdge = Color(red: 32.0/255, green: 38.0/255, blue: 31.0/255)       // #20261f
}

// MARK: - Anchor

/// What the panel needs to know about the composer underneath it.
///
///   chip — the trigger. The panel GROWS out of this rectangle, and sits a hair
///          above its top edge, which is what makes the opening legible.
///   lane — the composer the chip belongs to. The panel takes its left and
///          right edges from this, because on a phone the composer's own lane
///          is the only horizontal alignment that reads as deliberate: matched
///          to it, the panel is that composer's drawer. Aligned to the chip
///          alone, its far edge lands in the middle of the toolbar — over the
///          mic, aligned to nothing — which reads as a near miss even when the
///          arithmetic is exact.
struct ScoutRuntimeAnchors {
    var chip: Anchor<CGRect>?
    var lane: Anchor<CGRect>?
}

/// Anchors rather than a shared `@Namespace`: the chip is handed to the
/// composer through a generic `@ViewBuilder tools` slot several layers down,
/// and an anchor travels up that tree on its own without every intermediate
/// view having to carry a namespace it has no other use for. They also survive
/// the composer relaying under a raised keyboard, because both are re-read
/// every layout pass.
struct ScoutRuntimeAnchorKey: PreferenceKey {
    static let defaultValue = ScoutRuntimeAnchors()

    static func reduce(value: inout ScoutRuntimeAnchors, nextValue: () -> ScoutRuntimeAnchors) {
        let next = nextValue()
        if let chip = next.chip { value.chip = chip }
        if let lane = next.lane { value.lane = lane }
    }
}

extension View {
    /// Mark this view as the runtime panel's origin. Applied by the chip itself
    /// when it is a picker trigger; hosts never call it.
    ///
    /// `transform`, not `anchorPreference`: the lane is published by an
    /// ancestor of this view, and a plain `anchorPreference` up there would
    /// REPLACE its whole subtree's value — taking the chip anchor with it.
    /// Transforming leaves each contribution to fill in its own field.
    func scoutRuntimeAnchor() -> some View {
        transformAnchorPreference(key: ScoutRuntimeAnchorKey.self, value: .bounds) { anchors, anchor in
            anchors.chip = anchor
        }
    }

    /// Mark the composer the chip lives in. The panel takes its width and its
    /// left/right edges from this, so the two line up exactly. Optional — with
    /// no lane the panel falls back to hugging the chip's trailing edge.
    func scoutRuntimeLane() -> some View {
        transformAnchorPreference(key: ScoutRuntimeAnchorKey.self, value: .bounds) { anchors, anchor in
            anchors.lane = anchor
        }
    }

    /// Host side: overlay the anchored runtime panel on this container. The
    /// container has to be the one the chip lives in — that is what gives the
    /// panel something to grow out of.
    func scoutRuntimePicker(
        isPresented: Binding<Bool>,
        harnesses: [ComposerModelHarness],
        efforts: [ComposerEffortOption] = ComposerEffortOption.catalog,
        harnessId: Binding<String>,
        familyId: Binding<String>,
        effortId: Binding<String>
    ) -> some View {
        modifier(
            ScoutRuntimePickerPresenter(
                isPresented: isPresented,
                harnesses: harnesses,
                effortOptions: efforts,
                harnessId: harnessId,
                familyId: familyId,
                effortId: effortId
            )
        )
    }
}

// MARK: - Presenter

/// Places the panel against the chip and runs the grow/collapse.
///
/// Geometry, in the host's own coordinate space:
///   · the panel's BOTTOM edge sits a hair above the chip's top edge, so it
///     always opens upward — above the composer, and above the keyboard when
///     one is raised, because the chip is itself above it;
///   · its LEFT and RIGHT edges are the composer's, so the panel and the thing
///     it configures are one column (falling back to the chip's trailing edge
///     where no lane is published);
///   · it can be no taller than the room above the chip, and the model column
///     scrolls if that room is short.
private struct ScoutRuntimePickerPresenter: ViewModifier {
    @Binding var isPresented: Bool
    let harnesses: [ComposerModelHarness]
    let effortOptions: [ComposerEffortOption]
    @Binding var harnessId: String
    @Binding var familyId: String
    @Binding var effortId: String

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Side margin the panel keeps from the screen edges.
    private let margin: CGFloat = 12
    /// Air between the chip's top edge and the panel's bottom edge.
    private let gap: CGFloat = 10
    /// Fallback width where no composer lane is published — wide enough to
    /// hold the rail and a model list, narrow enough that its trailing edge
    /// can still land on the chip's rather than clamping to the screen.
    private let maxPanelWidth: CGFloat = 288
    /// Headroom kept above the panel so it never butts into the masthead.
    private let headroom: CGFloat = 8

    func body(content: Content) -> some View {
        content.overlayPreferenceValue(ScoutRuntimeAnchorKey.self) { anchors in
            GeometryReader { proxy in
                if let anchor = anchors.chip {
                    let chip = proxy[anchor]
                    let lane = anchors.lane.map { proxy[$0] }
                    // The composer's own column when there is one; otherwise
                    // hug the chip's trailing edge and clamp to the screen.
                    let rawLeft = lane?.minX ?? (chip.maxX - maxPanelWidth)
                    let rawWidth = lane.map { $0.width } ?? maxPanelWidth
                    let width = min(rawWidth, max(0, proxy.size.width - margin * 2))
                    let x = min(
                        max(margin, rawLeft),
                        max(margin, proxy.size.width - margin - width)
                    )
                    let floorY = max(0, chip.minY - gap)
                    let ceiling = max(140, floorY - headroom)

                    ZStack(alignment: .topLeading) {
                        if isPresented {
                            // The scrim covers the WHOLE surface, including the
                            // composer it is dimming — otherwise a tap meant for
                            // "put this away" lands in the draft field instead.
                            scrim
                            ZStack(alignment: .bottomLeading) {
                                // Pure geometry: it gives the stack the height
                                // that puts the panel's floor above the chip,
                                // and nothing else. Hit testing OFF — a clear
                                // colour is still a hit target, and this one
                                // spans everything above the panel, which is
                                // most of the scrim the operator is aiming at
                                // when they tap to dismiss.
                                Color.clear.allowsHitTesting(false)
                                ScoutRuntimePanel(
                                    harnesses: harnesses,
                                    effortOptions: effortOptions,
                                    harnessId: $harnessId,
                                    familyId: $familyId,
                                    effortId: $effortId,
                                    maxHeight: ceiling,
                                    onDismiss: close
                                )
                                .frame(width: width)
                                // The growth origin is the chip's centre,
                                // expressed in the panel's own space: the panel
                                // scales out of the point the finger touched and
                                // collapses back into it, so "where did this
                                // come from" is never a question. Declared
                                // INSIDE the leading padding — outside it, the
                                // unit point would be measured against the
                                // panel plus its offset, and the origin would
                                // drift the further the lane sits from the
                                // screen edge.
                                .transition(panelTransition(origin: UnitPoint(
                                    x: width > 0 ? min(max((chip.midX - x) / width, 0), 1) : 1,
                                    y: 1
                                )))
                                .padding(.leading, x)
                            }
                            // The stack's floor IS the panel's bottom edge — one
                            // frame does the anchoring, so there is no measured
                            // panel height to chase and nothing to re-layout when
                            // the model list changes under it.
                            .frame(width: proxy.size.width, height: floorY, alignment: .bottomLeading)
                            // A harness with more models makes the panel taller,
                            // and its TOP edge is the one that moves. That edge
                            // is placed by this container, not by the panel, so
                            // the animation has to live here too — inside the
                            // panel alone it animated its own height while its
                            // origin snapped, which is the jump you could see.
                            .animation(
                                ScoutMotion.honoring(reduceMotion, ScoutMotion.travel),
                                value: harnessId
                            )
                        }
                    }
                    .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
                }
            }
            .animation(ScoutMotion.honoring(reduceMotion, ScoutMotion.grow), value: isPresented)
        }
    }

    /// Light enough to keep the draft and the chip readable underneath — this
    /// is a panel on top of your message, not a modal instead of it.
    private var scrim: some View {
        Rectangle()
            .fill(Color.black.opacity(0.34))
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
            .onTapGesture { close() }
            .transition(.opacity.animation(ScoutMotion.fade))
            .accessibilityLabel("Close runtime picker")
            .accessibilityAddTraits(.isButton)
    }

    /// Reduce Motion keeps the EVENT and drops the travel: the panel still
    /// appears where it belongs, it just crossfades in instead of growing.
    private func panelTransition(origin: UnitPoint) -> AnyTransition {
        reduceMotion
            ? .opacity
            : .scale(scale: 0.88, anchor: origin).combined(with: .opacity)
    }

    private func close() {
        isPresented = false
    }
}

// MARK: - Panel

/// The panel itself: harness rail · model list · effort ladder. Every pick is
/// live — the chip under the scrim updates as you go.
struct ScoutRuntimePanel: View {
    let harnesses: [ComposerModelHarness]
    let effortOptions: [ComposerEffortOption]
    @Binding var harnessId: String
    @Binding var familyId: String
    @Binding var effortId: String
    /// The room the host has above the chip. The panel HUGS its rows and only
    /// consults this when there aren't enough of them to go round — a settings
    /// panel that stretched to fill whatever space it was offered would read as
    /// a sheet again, which is the thing being fixed.
    var maxHeight: CGFloat = .infinity
    var onDismiss: () -> Void

    @Namespace private var railMarker
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// One touch target, everywhere in the panel.
    private let row: CGFloat = 44
    private let railWidth: CGFloat = 100
    /// Air above and below each column's rows.
    private let columnPad: CGFloat = HudSpacing.sm

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
    }

    /// Rows are a known height, so the body's natural size is arithmetic rather
    /// than something to measure and chase.
    private var bodyHeight: CGFloat {
        let natural = CGFloat(max(harnesses.count, families.count)) * row + columnPad * 2
        let ladder = row + HudSpacing.xs
        let available = maxHeight.isFinite ? max(row * 2, maxHeight - ladder - 1) : natural
        return min(natural, available)
    }

    /// Resolution is tolerant: a stale or unknown id settles onto the first
    /// entry and that harness's default family rather than trapping the panel.
    private var harness: ComposerModelHarness {
        harnesses.first { $0.id == harnessId } ?? harnesses.first ?? ComposerModelHarness.catalog[0]
    }

    private var families: [ComposerModelFamily] { harness.families }

    private var efforts: [ComposerEffortOption] {
        let selectedModel = (families.first { $0.id == familyId } ?? harness.defaultFamily).value
        return supportedEfforts(harnessId: harness.id, model: selectedModel)
    }

    private func supportedEfforts(harnessId: String, model: String?) -> [ComposerEffortOption] {
        effortOptions.filter { option in
            guard option.harnesses.isEmpty || option.harnesses.contains(harnessId) else {
                return false
            }
            guard let models = option.models, !models.isEmpty, let model else {
                return true
            }
            return models.contains(model)
        }
    }

    private var effortIndex: Int {
        max(0, efforts.firstIndex { $0.id == effortId } ?? 0)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                rail
                Rectangle()
                    .fill(HudHairline.standard)
                    .frame(width: HudStrokeWidth.thin)
                models
            }
            .frame(height: bodyHeight)
            // The invariant, stated once: nothing in the two columns may reach
            // the effort ladder. Both of them clip already — this is the frame
            // that actually owns the promise.
            .clipped()
            Rectangle()
                .fill(HudHairline.standard)
                .frame(height: HudStrokeWidth.thin)
            effortLadder
        }
        // Switching harness changes how many models there are, so the panel
        // changes height. Its floor is pinned to the chip, so it grows and
        // shrinks UPWARD, from the control it belongs to — but only if the
        // change is animated. Unanimated it was a 44pt jump, which reads as a
        // glitch rather than as the panel making room.
        .animation(ScoutMotion.honoring(reduceMotion, ScoutMotion.travel), value: harness.id)
        .background {
            ScoutMachinedPlate(shape: shape, lightReach: 96, grainOpacity: 0.045)
                .shadow(color: .black.opacity(0.55), radius: 22, y: 10)
                .shadow(color: .black.opacity(0.4), radius: 4, y: 2)
        }
        .clipShape(shape)
        // Swipe down = the reverse of the way it opened. Simultaneous so the
        // model column keeps its own scrolling when a short screen makes it
        // scroll at all; the threshold is deliberately decisive.
        .simultaneousGesture(swipeDown)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Runtime")
        .accessibilityAddTraits(.isModal)
    }

    private var swipeDown: some Gesture {
        DragGesture(minimumDistance: 16)
            .onEnded { value in
                guard value.translation.height > 64,
                      value.translation.height > abs(value.translation.width) * 1.5 else { return }
                onDismiss()
            }
    }

    // MARK: Harness rail

    /// One marker travels between rows instead of every row growing an edge —
    /// the studio's rule, and the reason the rail reads as a single control.
    ///
    /// Scrolls and clips on the same terms as the model column. A plain stack
    /// here was fine only while the panel always had room for every harness:
    /// once `bodyHeight` clamps — a chip lower down the screen, or simply more
    /// harnesses than rungs — an unclipped stack overdraws the frame it was
    /// given and the last rail rows land ON TOP of the effort ladder.
    private var rail: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 0) {
                ForEach(harnesses) { entry in
                    let on = entry.id == harness.id
                    Button {
                        pick {
                            harnessId = entry.id
                            familyId = entry.defaultFamily.id
                            let selectedModel = entry.defaultFamily.value
                            let supported = supportedEfforts(harnessId: entry.id, model: selectedModel)
                            if !supported.contains(where: { $0.id == effortId }) {
                                effortId = supported.first(where: { $0.id == "medium" })?.id
                                    ?? supported.first?.id
                                    ?? ComposerEffortOption.defaultId
                            }
                        }
                    } label: {
                        HStack(spacing: HudSpacing.md) {
                            HarnessMark(harness: entry.id, size: 14)
                                .foregroundStyle(on ? HudPalette.accent : ScoutInk.dim)
                            Text(entry.short)
                                .font(HudFont.mono(HudTextSize.xs, weight: on ? .semibold : .medium))
                                .foregroundStyle(on ? HudPalette.ink : ScoutInk.muted)
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                            Spacer(minLength: 0)
                        }
                        .padding(.leading, HudSpacing.lg)
                        .padding(.trailing, HudSpacing.md)
                        .frame(height: row)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(alignment: .leading) {
                            if on {
                                Capsule()
                                    .fill(HudPalette.accent)
                                    .frame(width: 2, height: 18)
                                    .matchedGeometryEffect(id: "rail-marker", in: railMarker)
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(entry.label)
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
                // No trailing Spacer: a scroll view proposes nil height, so one
                // would collapse to nothing anyway. Scroll content is top-aligned,
                // which is the alignment the Spacer was buying.
            }
            .padding(.vertical, columnPad)
            .animation(ScoutMotion.honoring(reduceMotion, ScoutMotion.travel), value: harness.id)
        }
        .scrollBounceBehavior(.basedOnSize)
        .frame(width: railWidth)
        .clipped()
    }

    // MARK: Models

    private var models: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 0) {
                ForEach(families) { family in
                    let on = family.id == resolvedFamilyId
                    Button {
                        pick {
                            familyId = family.id
                            let supported = supportedEfforts(harnessId: harness.id, model: family.value)
                            if !supported.contains(where: { $0.id == effortId }) {
                                effortId = supported.first(where: { $0.id == "medium" })?.id
                                    ?? supported.first?.id
                                    ?? ComposerEffortOption.defaultId
                            }
                        }
                    } label: {
                        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.sm) {
                            Circle()
                                .fill(on ? HudPalette.accent : .clear)
                                .frame(width: 5, height: 5)
                                .alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
                            Text(family.label)
                                .font(HudFont.mono(HudTextSize.sm, weight: on ? .semibold : .medium))
                                .foregroundStyle(on ? HudPalette.ink : ScoutInk.muted)
                                .lineLimit(1)
                            if !family.sublabel.isEmpty {
                                Text(family.sublabel)
                                    .font(HudFont.mono(HudTextSize.xxs))
                                    .foregroundStyle(ScoutInk.dim)
                            }
                            Spacer(minLength: HudSpacing.sm)
                            if family.isDefault {
                                Text("DEFAULT")
                                    .font(HudFont.mono(HudTextSize.micro))
                                    .tracking(0.6)
                                    .foregroundStyle(ScoutInk.dim.opacity(0.75))
                                    .fixedSize()
                            }
                        }
                        .padding(.horizontal, HudSpacing.xl)
                        .frame(height: row)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(family.displayName)
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
            .padding(.vertical, columnPad)
            // A different harness is a different LIST, not the same list with
            // its rows rewritten. Re-keyed, it leaves and a new one arrives —
            // rising the short distance the panel is growing, so the swap and
            // the height change are one movement instead of two.
            .id(harness.id)
            .transition(
                reduceMotion
                    ? .opacity
                    : .opacity.combined(with: .offset(y: 10))
            )
        }
        .scrollBounceBehavior(.basedOnSize)
        .frame(maxWidth: .infinity)
        .clipped()
    }

    /// What the model column is actually showing as picked — the tolerant
    /// resolution, so a family id left over from another harness doesn't leave
    /// the list with nothing lit.
    private var resolvedFamilyId: String {
        (families.first { $0.id == familyId } ?? harness.defaultFamily).id
    }

    // MARK: Effort

    /// Ordinal, so it reads as a ladder rather than a list: everything up to
    /// the pick is filled, the pick itself is lit. Auto is the exception it
    /// looks like — it is "let the harness decide", not a rung below Low, so
    /// selecting it fills nothing.
    private var effortLadder: some View {
        HStack(spacing: HudSpacing.xs) {
            ForEach(Array(efforts.enumerated()), id: \.element.id) { index, option in
                let current = index == effortIndex
                let filled = index > 0 && index < effortIndex
                Button {
                    pick { effortId = option.id }
                } label: {
                    VStack(spacing: HudSpacing.sm) {
                        Capsule()
                            .fill(
                                current
                                    ? HudPalette.accent
                                    : (filled ? HudPalette.accent.opacity(0.34) : HudHairline.standard)
                            )
                            .frame(height: 3)
                        Text(option.label.uppercased())
                            .font(HudFont.mono(HudTextSize.micro, weight: current ? .bold : .medium))
                            .tracking(0.7)
                            .foregroundStyle(current ? HudPalette.ink : ScoutInk.dim)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: row)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(option.label) effort")
                .accessibilityAddTraits(current ? .isSelected : [])
            }
        }
        .padding(.horizontal, HudSpacing.xl)
        .padding(.bottom, HudSpacing.xs)
        .animation(ScoutMotion.honoring(reduceMotion, ScoutMotion.travel), value: effortIndex)
    }

    // MARK: Picking

    /// Every pick is live and reports itself in the hand — the chip under the
    /// scrim is the readout, so nothing here waits for a commit.
    private func pick(_ change: () -> Void) {
        change()
        #if canImport(UIKit)
        UISelectionFeedbackGenerator().selectionChanged()
        #endif
    }
}

// MARK: - Previews

#if DEBUG
/// The panel over a stand-in composer, so the resting chip, the scrim and the
/// panel are all in one frame — the state a screenshot of the running app
/// cannot reach without a finger.
private struct RuntimePickerPreviewStage: View {
    let harnesses: [ComposerModelHarness]
    @State var harnessId: String
    @State var familyId: String
    @State var effortId: String
    @State var open: Bool

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            // A stand-in for the composer's base row: the chip sits where
            // `ScoutMessageComposer` puts it, hard against the right end.
            HStack(spacing: HudSpacing.sm) {
                Text("Ask the fleet…")
                    .font(HudFont.ui(HudTextSize.lg))
                    .foregroundStyle(ScoutInk.dim)
                Spacer(minLength: HudSpacing.md)
                ScoutRuntimeChip(
                    harness: harnessId,
                    model: family.value,
                    effort: effort.label,
                    isPicking: open,
                    onPick: { open.toggle() }
                )
                Circle()
                    .fill(ScoutSurface.inset)
                    .frame(width: 28, height: 28)
            }
            .padding(.horizontal, HudSpacing.xxl)
            .padding(.vertical, HudSpacing.xl)
            .background(
                RoundedRectangle(cornerRadius: 21, style: .continuous).fill(ScoutSurface.raised)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 21, style: .continuous)
                    .stroke(HudHairline.standard, lineWidth: HudStrokeWidth.thin)
            )
            .scoutRuntimeLane()
            .padding(.horizontal, HudSpacing.xxl)
            .padding(.bottom, HudSpacing.huge)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(ScoutCanvas().ignoresSafeArea())
        .scoutRuntimePicker(
            isPresented: $open,
            harnesses: harnesses,
            harnessId: $harnessId,
            familyId: $familyId,
            effortId: $effortId
        )
    }

    private var harness: ComposerModelHarness {
        harnesses.first { $0.id == harnessId } ?? harnesses[0]
    }

    private var family: ComposerModelFamily {
        harness.families.first { $0.id == familyId } ?? harness.defaultFamily
    }

    private var effort: ComposerEffortOption {
        ComposerEffortOption.catalog.first { $0.id == effortId } ?? ComposerEffortOption.catalog[0]
    }
}

/// The panel on its own, at its shipped width — for reading the rail, the
/// model rows and the ladder without the stage around them.
private struct ScoutRuntimePanelPreview: View {
    @State private var harnessId = "claude"
    @State private var familyId = "claude-opus-5"
    @State private var effortId = "medium"

    var body: some View {
        ZStack {
            HudPalette.bg.ignoresSafeArea()
            ScoutRuntimePanel(
                harnesses: ComposerModelHarness.catalog,
                effortOptions: ComposerEffortOption.catalog,
                harnessId: $harnessId,
                familyId: $familyId,
                effortId: $effortId,
                onDismiss: {}
            )
            .frame(width: 320)
        }
    }
}

#Preview("Runtime picker · open") {
    RuntimePickerPreviewStage(
        harnesses: ComposerModelHarness.catalog,
        harnessId: "claude",
        familyId: "claude-opus-5",
        effortId: "auto",
        open: true
    )
}

#Preview("Runtime picker · open · codex, high") {
    RuntimePickerPreviewStage(
        harnesses: ComposerModelHarness.catalog,
        harnessId: "codex",
        familyId: "gpt-5.6-luna",
        effortId: "high",
        open: true
    )
}

#Preview("Runtime picker · resting") {
    RuntimePickerPreviewStage(
        harnesses: ComposerModelHarness.catalog,
        harnessId: "claude",
        familyId: "claude-sonnet-4-6",
        effortId: "medium",
        open: false
    )
}

#Preview("Runtime picker · panel only") {
    ScoutRuntimePanelPreview()
}
#endif
