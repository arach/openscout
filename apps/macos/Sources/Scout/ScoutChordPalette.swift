import HudsonUI
import SwiftUI

/// The `g`-chord palette — the rail, lit up.
///
/// This is a Scout-owned overlay stacked on the navigation sidebar rather than
/// an accessory inside `HudSidebarItem` (which has no slot for one). It is
/// drawn to the sidebar's own frame with the sidebar's own chrome fill and row
/// pitch, so arming the chord reads as the rail changing state, not as a menu
/// appearing over it: same nine destinations, same order, same place the eye
/// already goes for them. Nothing new to learn spatially — only the letters.
///
/// Compact rail (icons only) shows the chips alone; the labels are what the
/// user already collapsed away.
struct ScoutChordPalette: View {
    let isCompact: Bool
    let activeSection: ScoutSection
    let onSelect: (ScoutSection) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            header

            ForEach(ScoutKeyMap.destinations) { entry in
                row(section: entry.section, chord: entry.chord, label: entry.section.title)
            }

            Spacer(minLength: HudSpacing.md)

            footer
        }
        .padding(.horizontal, HudSpacing.sm)
        .padding(.vertical, HudSpacing.md)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(ScoutDesign.chrome)
        .overlay(alignment: .trailing) {
            Rectangle()
                .fill(ScoutDesign.hairline)
                .frame(width: HudStrokeWidth.thin)
        }
    }

    private var header: some View {
        HStack(spacing: HudSpacing.xs) {
            Text("g")
                .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                .foregroundStyle(ScoutPalette.accent)
                .padding(.horizontal, 4)
                .padding(.vertical, 1)
                .overlay(
                    RoundedRectangle(cornerRadius: HudRadius.tight)
                        .stroke(ScoutPalette.accent.opacity(0.6), lineWidth: HudStrokeWidth.thin)
                )
            if !isCompact {
                Text("GO TO")
                    .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                    .foregroundStyle(ScoutPalette.dim)
                    .tracking(1.0)
            }
        }
        .padding(.horizontal, 2)
        .padding(.bottom, HudSpacing.xs)
    }

    private func row(section: ScoutSection, chord: String, label: String) -> some View {
        Button {
            onSelect(section)
        } label: {
            HStack(spacing: HudSpacing.sm) {
                chip(chord, emphasized: true)
                if !isCompact {
                    Text(label)
                        .font(HudFont.ui(HudTextSize.sm, weight: section == activeSection ? .semibold : .regular))
                        .foregroundStyle(section == activeSection ? ScoutPalette.ink : ScoutPalette.muted)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                }
            }
            .padding(.horizontal, 2)
            .frame(height: 26)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                    .fill(section == activeSection ? ScoutDesign.bg : Color.clear)
            )
        }
        .buttonStyle(.plain)
        // The palette is keyboard-first by construction — a system focus ring
        // on whichever row happened to be first would read as a selection the
        // user didn't make.
        .focusEffectDisabled()
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(ScoutKeyMap.extras) { extra in
                HStack(spacing: HudSpacing.sm) {
                    chip(extra.key, emphasized: false)
                    if !isCompact {
                        Text(extra.label)
                            .font(HudFont.ui(HudTextSize.sm))
                            .foregroundStyle(ScoutPalette.dim)
                            .lineLimit(1)
                        Spacer(minLength: 0)
                    }
                }
                .padding(.horizontal, 2)
                .frame(height: 22)
            }
        }
    }

    private func chip(_ key: String, emphasized: Bool) -> some View {
        Text(key)
            .font(HudFont.mono(HudTextSize.xs, weight: .bold))
            .foregroundStyle(emphasized ? ScoutDesign.chrome : ScoutPalette.muted)
            .frame(width: 18, height: 18)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                    .fill(emphasized ? ScoutPalette.accent : Color.clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                    .stroke(emphasized ? Color.clear : ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
            )
    }
}

/// The ⌘-digit jump chip stamped onto a conversation row while the modifier is
/// held. Sized and cornered to the row's 32pt avatar tile so it lands exactly
/// on top of it — the row doesn't reflow when the targets appear.
struct ScoutJumpTargetChip: View {
    let index: Int

    var body: some View {
        Text("\(index)")
            .font(HudFont.mono(HudTextSize.base, weight: .bold))
            .foregroundStyle(ScoutDesign.chrome)
            .frame(width: 32, height: 32)
            .background(
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(ScoutPalette.accent)
            )
    }
}
