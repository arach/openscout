import HudsonUI
import SwiftUI

/// Keyboard cheatsheet, toggled by `?` or ⌘/.
///
/// Generated from `ScoutKeyMap` rather than written out beside it, which is the
/// whole point: the sheet cannot describe a binding that doesn't exist, and a
/// new destination cannot ship undocumented.
///
/// Two columns because the user arrives with two different questions, and the
/// old single stack of seven equal-weight groups answered neither well — six of
/// its seven section groups were always for a section you weren't in.
///
///   Left  — *where can I go*. The stable half. Same order as the rail and the
///           chord palette, so the sheet rehearses the muscle memory instead of
///           teaching a second layout for the same nine things.
///   Right — *what works here*. The volatile half: active section first, then
///           the bindings that mean the same thing on every list.
///
/// Esc, ⌘/, or a scrim tap dismisses.
struct ScoutKeyboardCheatsheet: View {
    let section: ScoutSection
    let onDismiss: () -> Void

    /// Split point for the left column's two-up chord grid. Column-major, so
    /// reading down column one then column two walks the rail top to bottom —
    /// row-major would interleave and break the rehearsal.
    private var chordColumns: (leading: [ScoutKeyMap.Destination], trailing: [ScoutKeyMap.Destination]) {
        let all = ScoutKeyMap.destinations
        let split = (all.count + 1) / 2
        return (Array(all.prefix(split)), Array(all.dropFirst(split)))
    }

    var body: some View {
        ZStack {
            ScoutDesign.bg.opacity(0.9)
                .ignoresSafeArea()
                .onTapGesture(perform: onDismiss)

            card
                .frame(maxWidth: 640)
                .padding(HudSpacing.xxl)
        }
    }

    private var card: some View {
        VStack(spacing: 0) {
            titleBar
            HudDivider(color: ScoutDesign.hairline)
            HStack(alignment: .top, spacing: 0) {
                goColumn
                    .frame(maxWidth: .infinity, alignment: .leading)
                contextColumn
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            // The column rule is an overlay, not a sibling. A `Rectangle` in
            // the HStack is greedy in *both* axes — pinning its width leaves
            // the height unbounded, and it drags the whole card down the
            // window. As an overlay it inherits the row's measured height, and
            // the columns are equal-width so centred is exactly the seam.
            .overlay {
                Rectangle()
                    .fill(ScoutDesign.hairline)
                    .frame(width: HudStrokeWidth.thin)
            }
            HudDivider(color: ScoutDesign.hairline)
            footerBar
        }
        .background(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .fill(ScoutDesign.chrome)
        )
        .overlay(
            RoundedRectangle(cornerRadius: HudRadius.card, style: .continuous)
                .stroke(ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
        )
        .shadow(color: Color.black.opacity(0.3), radius: 24, y: 12)
    }

    private var titleBar: some View {
        HStack(alignment: .firstTextBaseline) {
            HudSectionLabel("Keyboard")
            Spacer()
            HStack(spacing: HudSpacing.xs) {
                keyCap("⌘/")
                Text("toggle")
                    .font(HudFont.mono(HudTextSize.micro))
                    .foregroundStyle(ScoutPalette.dim)
            }
        }
        .padding(.horizontal, HudSpacing.xl)
        .padding(.vertical, HudSpacing.lg)
    }

    // MARK: Left — where you can go

    private var goColumn: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xl) {
            VStack(alignment: .leading, spacing: HudSpacing.sm) {
                HStack(spacing: HudSpacing.xs) {
                    HudSectionLabel("Go — press")
                    keyCap("g")
                    HudSectionLabel(", then")
                }
                HStack(alignment: .top, spacing: HudSpacing.xl) {
                    chordList(chordColumns.leading, extras: [])
                    chordList(chordColumns.trailing, extras: ScoutKeyMap.extras)
                }
            }

            VStack(alignment: .leading, spacing: HudSpacing.sm) {
                HStack(spacing: HudSpacing.xs) {
                    HudSectionLabel("Jump — hold")
                    keyCap("⌘")
                }
                kbd("⌘1 … ⌘9", "the nine most recent chats")
                Text("Fires from inside the composer too.")
                    .font(HudFont.ui(HudTextSize.xs))
                    .foregroundStyle(ScoutPalette.dim)
            }
        }
        .padding(HudSpacing.xl)
    }

    private func chordList(_ items: [ScoutKeyMap.Destination], extras: [ScoutKeyMap.Extra]) -> some View {
        VStack(alignment: .leading, spacing: HudSpacing.xs) {
            ForEach(items) { item in
                chordRow(
                    key: item.chord,
                    label: item.section.title,
                    active: item.section == section
                )
            }
            ForEach(extras) { extra in
                chordRow(key: extra.key, label: extra.label, active: false, muted: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func chordRow(key: String, label: String, active: Bool, muted: Bool = false) -> some View {
        HStack(spacing: HudSpacing.sm) {
            keyCap(key, filled: active)
            Text(label)
                .font(HudFont.ui(HudTextSize.sm, weight: active ? .semibold : .regular))
                .foregroundStyle(muted ? ScoutPalette.dim : (active ? ScoutPalette.ink : ScoutPalette.muted))
                .lineLimit(1)
            Spacer(minLength: 0)
        }
    }

    // MARK: Right — what works here

    private var contextColumn: some View {
        VStack(alignment: .leading, spacing: HudSpacing.xl) {
            VStack(alignment: .leading, spacing: HudSpacing.sm) {
                HStack(spacing: HudSpacing.xs) {
                    Text("\(section.title.uppercased()) — HERE")
                        .font(HudFont.mono(HudTextSize.micro, weight: .bold))
                        .foregroundStyle(ScoutPalette.accent)
                        .tracking(1.0)
                }
                let entries = ScoutKeyMap.contextEntries(for: section)
                if entries.isEmpty {
                    Text("No section keys — this surface owns its own controls.")
                        .font(HudFont.ui(HudTextSize.xs))
                        .foregroundStyle(ScoutPalette.dim)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    ForEach(entries) { entry in
                        kbd(entry.keys, entry.detail)
                    }
                }
            }

            VStack(alignment: .leading, spacing: HudSpacing.sm) {
                HudSectionLabel("Move — any list")
                ForEach(ScoutKeyMap.moveEntries) { entry in
                    kbd(entry.keys, entry.detail)
                }
            }
        }
        .padding(HudSpacing.xl)
    }

    private var footerBar: some View {
        HStack(spacing: HudSpacing.sm) {
            keyCap("?")
            Text("this sheet")
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(ScoutPalette.dim)
            Spacer()
            keyCap("Esc")
            Text("close")
                .font(HudFont.mono(HudTextSize.micro))
                .foregroundStyle(ScoutPalette.dim)
        }
        .padding(.horizontal, HudSpacing.xl)
        .padding(.vertical, HudSpacing.md)
    }

    // MARK: Pieces

    private func kbd(_ key: String, _ desc: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: HudSpacing.md) {
            keyCap(key)
                .frame(minWidth: 84, alignment: .leading)
            Text(desc)
                .font(HudFont.ui(HudTextSize.sm))
                .foregroundStyle(ScoutPalette.muted)
            Spacer(minLength: 0)
        }
    }

    private func keyCap(_ key: String, filled: Bool = false) -> some View {
        Text(key)
            .font(HudFont.mono(HudTextSize.xs, weight: .bold))
            .foregroundStyle(filled ? ScoutDesign.chrome : ScoutPalette.ink)
            .padding(.horizontal, HudSpacing.sm)
            .padding(.vertical, 1.5)
            .background(
                RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                    .fill(filled ? ScoutPalette.accent : Color.clear)
            )
            .overlay(
                RoundedRectangle(cornerRadius: HudRadius.tight, style: .continuous)
                    .stroke(filled ? Color.clear : ScoutDesign.hairlineStrong, lineWidth: HudStrokeWidth.thin)
            )
    }
}
