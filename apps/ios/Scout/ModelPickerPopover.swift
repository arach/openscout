// ModelPickerPopover — the composer model picker, ported from the approved
// studio study (design/studio/views/model-picker.tsx, v5). A machined raised
// plate that rises from the bottom over a dim scrim, with three horizontal
// stops:
//
//   01 HARNESS  vertical plates — a big monogram tile, one-word label beneath.
//   02 FAMILY   one flat row of chips (bold name + dim version sublabel); the
//               harness's default family carries a DEFAULT tag and comes
//               pre-selected — there is deliberately no "harness decides" row.
//   03 EFFORT   one connected inset track: Auto / Low / Medium / High.
//
// Ways out: swipe-down on the plate or a scrim tap CANCELS (the draft is
// dropped); the lime Done button COMMITS the draft into the composer. The
// catalog mirrors the real `--model` values the surface passes to the CLI —
// only harnesses the app actually supports ship here; new harnesses slot in
// by appending to `ComposerModelHarness.catalog`.

import SwiftUI
import HudsonUI

// MARK: - Catalog

/// One selectable model family — a single flat pick (no separate version row).
/// `value` is the string passed verbatim to the CLI as `--model`; nil means
/// "harness decides" and is only used for machine-reported harnesses we don't
/// curate models for.
struct ComposerModelFamily: Identifiable, Hashable {
    let id: String          // selection id — the --model value, or "auto"
    let label: String       // bold family name, e.g. "Opus"
    let sublabel: String    // dim version, e.g. "4.8"
    let value: String?
    let isDefault: Bool

    /// Token/summary rendering, e.g. "Opus 4.8" or "5.6 sol".
    var displayName: String { sublabel.isEmpty ? label : "\(label) \(sublabel)" }
}

/// One harness plate: a big monogram tile over a one-word label, plus its
/// hand-picked family list with exactly ONE default (pre-selected, tagged
/// DEFAULT in the row).
struct ComposerModelHarness: Identifiable, Hashable {
    let id: String          // spec `execution.harness`, e.g. "claude"
    let label: String       // full label, e.g. "Claude Code" (results, menus)
    let short: String       // one-word plate label, e.g. "Claude"
    let monogram: String    // tile glyph until real harness logo assets land
    let families: [ComposerModelFamily]

    var defaultFamily: ComposerModelFamily {
        families.first(where: \.isDefault) ?? families[0]
    }

    static let catalog: [ComposerModelHarness] = [
        ComposerModelHarness(id: "claude", label: "Claude Code", short: "Claude", monogram: "✳", families: [
            ComposerModelFamily(id: "claude-opus-4-8", label: "Opus", sublabel: "4.8", value: "claude-opus-4-8", isDefault: true),
            ComposerModelFamily(id: "claude-sonnet-4-6", label: "Sonnet", sublabel: "4.6", value: "claude-sonnet-4-6", isDefault: false),
            ComposerModelFamily(id: "fable", label: "Fable", sublabel: "alpha", value: "fable", isDefault: false),
        ]),
        ComposerModelHarness(id: "codex", label: "Codex", short: "Codex", monogram: "◈", families: [
            ComposerModelFamily(id: "gpt-5.6-sol", label: "5.6", sublabel: "sol", value: "gpt-5.6-sol", isDefault: true),
            ComposerModelFamily(id: "gpt-5.6-terra", label: "5.6", sublabel: "terra", value: "gpt-5.6-terra", isDefault: false),
            ComposerModelFamily(id: "gpt-5.6-luna", label: "5.6", sublabel: "luna", value: "gpt-5.6-luna", isDefault: false),
            ComposerModelFamily(id: "gpt-5.5-mini", label: "5.5", sublabel: "mini", value: "gpt-5.5-mini", isDefault: false),
        ]),
    ]

    static func curated(_ id: String) -> ComposerModelHarness? {
        catalog.first { $0.id == id }
    }

    /// A plate for a machine-reported harness we don't curate models for: one
    /// Auto family that omits `--model` so the harness picks its own default.
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

/// One reasoning-effort stop. `value` is the spec's `execution.reasoningEffort`;
/// nil for Auto — the field is omitted and the harness decides.
struct ComposerEffortOption: Identifiable, Hashable {
    let id: String
    let label: String
    let value: String?

    static let defaultId = "auto"
    static let catalog: [ComposerEffortOption] = [
        ComposerEffortOption(id: defaultId, label: "Auto", value: nil),
        ComposerEffortOption(id: "low", label: "Low", value: "low"),
        ComposerEffortOption(id: "medium", label: "Medium", value: "medium"),
        ComposerEffortOption(id: "high", label: "High", value: "high"),
    ]
}

// MARK: - Study palette

/// The study's scoped CSS values (`.mp-` prefixed), verbatim. Kept local to
/// the picker rather than folded into Theme — the machined graphite plate is
/// a study-specific look, distinct from the tone-aware cockpit surfaces.
enum ModelPickerTone {
    static let ink = Color(red: 242.0/255, green: 244.0/255, blue: 239.0/255)          // #f2f4ef
    static let muted = Color(red: 170.0/255, green: 177.0/255, blue: 167.0/255)        // #aab1a7
    static let dim = Color(red: 119.0/255, green: 126.0/255, blue: 117.0/255)          // #777e75
    static let faint = Color(red: 76.0/255, green: 85.0/255, blue: 78.0/255)           // #4c554e
    static let accent = Color(red: 166.0/255, green: 239.0/255, blue: 135.0/255)       // #a6ef87
    static let accentDim = accent.opacity(0.5)
    static let accentSoft = accent.opacity(0.09)
    static let scrim = Color(red: 3.0/255, green: 4.0/255, blue: 3.0/255).opacity(0.5) // rgba(3,4,3,.5)
    static let plateTop = Color(red: 22.0/255, green: 25.0/255, blue: 27.0/255)        // #16191b
    static let plateBottom = Color(red: 13.0/255, green: 15.0/255, blue: 16.0/255)     // #0d0f10
    static let plateEdge = Color(red: 43.0/255, green: 48.0/255, blue: 45.0/255)       // #2b302d
    static let chipFill = Color(red: 11.0/255, green: 14.0/255, blue: 12.0/255)        // #0b0e0c
    static let chipEdge = Color(red: 30.0/255, green: 35.0/255, blue: 32.0/255)        // #1e2320
    static let insetFill = Color(red: 7.0/255, green: 9.0/255, blue: 7.0/255)          // #070907
    static let insetEdge = Color(red: 24.0/255, green: 29.0/255, blue: 25.0/255)       // #181d19
    static let tileEdge = Color(red: 28.0/255, green: 33.0/255, blue: 29.0/255)        // #1c211d
    static let grabber = Color(red: 44.0/255, green: 50.0/255, blue: 46.0/255)         // #2c322e
    static let tokenEdge = Color(red: 32.0/255, green: 38.0/255, blue: 31.0/255)       // #20261f
    static let selPlateTop = Color(red: 24.0/255, green: 29.0/255, blue: 22.0/255)     // #181d16
    static let selPlateBottom = Color(red: 16.0/255, green: 19.0/255, blue: 14.0/255)  // #10130e
    static let selEffortTop = Color(red: 26.0/255, green: 31.0/255, blue: 26.0/255)    // #1a1f1a
    static let selEffortBottom = Color(red: 18.0/255, green: 21.0/255, blue: 15.0/255) // #12150f
    static let doneTop = Color(red: 183.0/255, green: 245.0/255, blue: 156.0/255)      // #b7f59c
    static let doneBottom = Color(red: 147.0/255, green: 221.0/255, blue: 114.0/255)   // #93dd72
    static let doneInk = Color(red: 10.0/255, green: 12.0/255, blue: 10.0/255)         // #0a0c0a
}

// MARK: - Popover

/// The raised plate. Edits a DRAFT seeded from the composer's current pick;
/// Done is the only path that writes it back — scrim taps and swipe-downs
/// drop the draft untouched.
struct ModelPickerPopover: View {
    /// Plates to show — the curated catalog trimmed to the machine's live
    /// harness set, plus single-Auto-family fallbacks for anything live we
    /// don't curate (resolved by the surface, which owns the workspace data).
    let harnesses: [ComposerModelHarness]
    @Binding var harnessId: String
    @Binding var familyId: String
    @Binding var effortId: String
    let onCommit: () -> Void
    let onCancel: () -> Void

    @State private var draftHarness: String
    @State private var draftFamily: String
    @State private var draftEffort: String

    init(
        harnesses: [ComposerModelHarness],
        harnessId: Binding<String>,
        familyId: Binding<String>,
        effortId: Binding<String>,
        onCommit: @escaping () -> Void,
        onCancel: @escaping () -> Void
    ) {
        self.harnesses = harnesses
        self._harnessId = harnessId
        self._familyId = familyId
        self._effortId = effortId
        self.onCommit = onCommit
        self.onCancel = onCancel
        _draftHarness = State(initialValue: harnessId.wrappedValue)
        _draftFamily = State(initialValue: familyId.wrappedValue)
        _draftEffort = State(initialValue: effortId.wrappedValue)
    }

    /// Resolution is tolerant: a stale/unknown draft id settles onto the first
    /// plate and that harness's default family rather than crashing the plate.
    private var harness: ComposerModelHarness {
        harnesses.first { $0.id == draftHarness } ?? harnesses[0]
    }

    private var family: ComposerModelFamily {
        harness.families.first { $0.id == draftFamily } ?? harness.defaultFamily
    }

    private var effort: ComposerEffortOption {
        ComposerEffortOption.catalog.first { $0.id == draftEffort } ?? ComposerEffortOption.catalog[0]
    }

    var body: some View {
        VStack(spacing: 13) {
            grabber
            harnessStop
            familyStop
            effortStop
            footer
        }
        .padding(EdgeInsets(top: 10, leading: 14, bottom: 12, trailing: 14))
        .background(plate)
        .gesture(swipeDown)
    }

    /// The machined plate: vertical graphite gradient, a top rim light fading
    /// into the edge colour, and the study's deep double drop shadow.
    private var plate: some View {
        RoundedRectangle(cornerRadius: 16, style: .continuous)
            .fill(LinearGradient(
                colors: [ModelPickerTone.plateTop, ModelPickerTone.plateBottom],
                startPoint: .top,
                endPoint: .bottom
            ))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(LinearGradient(
                        colors: [.white.opacity(0.09), ModelPickerTone.plateEdge],
                        startPoint: .top,
                        endPoint: .bottom
                    ), lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.65), radius: 24, y: 12)
            .shadow(color: .black.opacity(0.5), radius: 4, y: 2)
    }

    private var grabber: some View {
        RoundedRectangle(cornerRadius: 2, style: .continuous)
            .fill(ModelPickerTone.grabber)
            .frame(width: 36, height: 4)
            .frame(maxWidth: .infinity)
    }

    /// Swipe-down anywhere on the plate dismisses as a CANCEL (same as the
    /// scrim) — vertical drags only, so the H-scroll rows keep their gestures.
    private var swipeDown: some Gesture {
        DragGesture(minimumDistance: 12)
            .onEnded { value in
                guard value.translation.height > 60,
                      value.translation.height > abs(value.translation.width) else { return }
                onCancel()
            }
    }

    // MARK: 01 — Harness

    private var harnessStop: some View {
        VStack(alignment: .leading, spacing: 7) {
            stopLabel(number: "01", name: "Harness", caption: "\(harnesses.count) available")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(harnesses) { entry in
                        harnessPlate(entry)
                    }
                }
                .padding(.bottom, 3)
            }
        }
    }

    private func harnessPlate(_ entry: ComposerModelHarness) -> some View {
        let selected = draftHarness == entry.id
        return Button {
            // Switching harness re-seats the family on that harness's default;
            // the effort stop carries over.
            draftHarness = entry.id
            draftFamily = entry.defaultFamily.id
        } label: {
            VStack(spacing: 8) {
                Text(entry.monogram)
                    .font(.system(size: 19))
                    .foregroundStyle(selected ? ModelPickerTone.accent : ModelPickerTone.muted)
                    .frame(width: 42, height: 42)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(ModelPickerTone.insetFill)
                            .overlay(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .stroke(selected ? ModelPickerTone.accentDim : ModelPickerTone.tileEdge, lineWidth: 1)
                            )
                    )
                Text(entry.short)
                    .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(selected ? ModelPickerTone.accent : ModelPickerTone.ink)
                    .lineLimit(1)
            }
            .frame(width: 88)
            .padding(EdgeInsets(top: 12, leading: 8, bottom: 10, trailing: 8))
            .background(
                RoundedRectangle(cornerRadius: 13, style: .continuous)
                    .fill(selected
                          ? LinearGradient(colors: [ModelPickerTone.selPlateTop, ModelPickerTone.selPlateBottom], startPoint: .top, endPoint: .bottom)
                          : LinearGradient(colors: [ModelPickerTone.chipFill, ModelPickerTone.chipFill], startPoint: .top, endPoint: .bottom))
                    .overlay(
                        RoundedRectangle(cornerRadius: 13, style: .continuous)
                            .stroke(selected ? ModelPickerTone.accentDim : ModelPickerTone.chipEdge, lineWidth: 1)
                    )
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: 02 — Family

    private var familyStop: some View {
        VStack(alignment: .leading, spacing: 7) {
            stopLabel(number: "02", name: "Family", caption: harness.short)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(harness.families) { entry in
                        familyChip(entry)
                    }
                }
                .padding(.bottom, 3)
            }
        }
    }

    private func familyChip(_ entry: ComposerModelFamily) -> some View {
        let selected = draftFamily == entry.id
        return Button {
            draftFamily = entry.id
        } label: {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(entry.label)
                    .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(selected ? ModelPickerTone.accent : ModelPickerTone.ink)
                if !entry.sublabel.isEmpty {
                    Text(entry.sublabel)
                        .font(HudFont.mono(HudTextSize.xxs))
                        .foregroundStyle(ModelPickerTone.faint)
                }
                if entry.isDefault {
                    Text("DEFAULT")
                        .font(HudFont.mono(HudTextSize.xxs))
                        .tracking(0.6)
                        .foregroundStyle(ModelPickerTone.dim)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(selected ? ModelPickerTone.accentSoft : ModelPickerTone.chipFill)
                    .overlay(
                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .stroke(selected ? ModelPickerTone.accentDim : ModelPickerTone.chipEdge, lineWidth: 1)
                    )
            )
        }
        .buttonStyle(.plain)
    }

    // MARK: 03 — Effort

    private var effortStop: some View {
        VStack(alignment: .leading, spacing: 7) {
            stopLabel(number: "03", name: "Effort", caption: "applies to \(family.displayName)")
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 4) {
                    ForEach(ComposerEffortOption.catalog) { option in
                        effortButton(option)
                    }
                }
                .padding(3)
            }
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(ModelPickerTone.insetFill)
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(ModelPickerTone.insetEdge, lineWidth: 1)
                    )
            )
        }
    }

    private func effortButton(_ option: ComposerEffortOption) -> some View {
        let selected = draftEffort == option.id
        return Button {
            draftEffort = option.id
        } label: {
            Text(option.label)
                .font(HudFont.mono(HudTextSize.xs, weight: selected ? .semibold : .regular))
                .foregroundStyle(selected ? ModelPickerTone.accent : ModelPickerTone.dim)
                .frame(minWidth: 64)
                .padding(.horizontal, 12)
                .padding(.vertical, 7)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(selected
                              ? LinearGradient(colors: [ModelPickerTone.selEffortTop, ModelPickerTone.selEffortBottom], startPoint: .top, endPoint: .bottom)
                              : LinearGradient(colors: [.clear, .clear], startPoint: .top, endPoint: .bottom))
                        .overlay(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .stroke(selected ? ModelPickerTone.accentDim : .clear, lineWidth: 1)
                        )
                )
        }
        .buttonStyle(.plain)
    }

    // MARK: The way out

    /// Running summary (harness bold) + the lime commit. A hairline separates
    /// the footer from the stops, as in the study.
    private var footer: some View {
        VStack(spacing: 11) {
            Rectangle()
                .fill(ModelPickerTone.ink.opacity(0.06))
                .frame(height: 1)
            HStack(spacing: 10) {
                (Text(harness.short)
                    .font(HudFont.mono(HudTextSize.xs, weight: .semibold))
                    .foregroundStyle(ModelPickerTone.ink)
                 + Text(" \(family.displayName) · \(effort.label)")
                    .font(HudFont.mono(HudTextSize.xs))
                    .foregroundStyle(ModelPickerTone.muted))
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 0)
                Button {
                    harnessId = harness.id
                    familyId = family.id
                    effortId = effort.id
                    onCommit()
                } label: {
                    Text("Done")
                        .font(HudFont.mono(HudTextSize.xs, weight: .bold))
                        .tracking(0.6)
                        .foregroundStyle(ModelPickerTone.doneInk)
                        .padding(.horizontal, 18)
                        .padding(.vertical, 8)
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(LinearGradient(
                                    colors: [ModelPickerTone.doneTop, ModelPickerTone.doneBottom],
                                    startPoint: .top,
                                    endPoint: .bottom
                                ))
                        )
                }
                .buttonStyle(.plain)
            }
        }
    }

    // MARK: Stop labels

    private func stopLabel(number: String, name: String, caption: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 7) {
            Text(number)
                .font(HudFont.mono(HudTextSize.xxs))
                .tracking(1)
                .foregroundStyle(ModelPickerTone.faint)
            Text(name)
                .font(HudFont.mono(HudTextSize.xxs, weight: .medium))
                .tracking(1.4)
                .textCase(.uppercase)
                .foregroundStyle(ModelPickerTone.dim)
            Spacer(minLength: 0)
            Text(caption)
                .font(HudFont.mono(HudTextSize.xxs))
                .foregroundStyle(ModelPickerTone.faint)
                .lineLimit(1)
        }
    }
}
