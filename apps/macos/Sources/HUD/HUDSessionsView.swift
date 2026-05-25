import SwiftUI

// Sessions view — teletype edition.
//
// The thesis: each local terminal session is a tape line printed by
// the broker. Big mono name, a tiny terminal-window glyph, a meta
// line below. Attached sessions get a real blinking cursor block —
// the only place in the HUD where literal "terminal" reads true.
// Section head "Local sessions" matches the broadsheet voice.

struct HUDSessionsView: View {
    @ObservedObject var scanner: SessionScanner = .shared
    var onActivate: (ScoutSession) -> Void

    var body: some View {
        Group {
            if scanner.sessions.isEmpty {
                emptyState
            } else {
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(alignment: .leading, spacing: 0) {
                        sectionHeader
                        ForEach(Array(scanner.sessions.enumerated()), id: \.element.id) { idx, s in
                            SessionRow(
                                session: s,
                                isSelected: idx == 0,
                                onTap: { onActivate(s) }
                            )
                        }
                    }
                    .padding(.bottom, 12)
                }
            }
        }
        .onAppear { scanner.start() }
        .onDisappear { scanner.stop() }
    }

    // Section head — matches Tail's broadsheet rhythm.
    private var sectionHeader: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 0) {
                HUDEyebrow(
                    text: "TERMINALS  ·  \(scanner.sessions.count)  ROOM\(scanner.sessions.count == 1 ? "" : "S")",
                    color: HUDChrome.inkDeep
                )
                Spacer(minLength: 8)
            }
            Text("Local sessions")
                .font(HUDType.body(15, weight: .semibold))
                .foregroundStyle(HUDChrome.ink)
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(HUDChrome.borderStrong)
                .frame(height: 0.5)
                .padding(.horizontal, 16)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 24)

            EmptyTerminalMark()
                .frame(width: 44, height: 30)
                .opacity(0.8)

            HUDEyebrow(text: "TERMINALS  ·  NONE OPEN", color: HUDChrome.inkDeep)
                .padding(.top, 18)

            Text("No rooms running.")
                .font(HUDType.body(15, weight: .semibold))
                .foregroundStyle(HUDChrome.ink)
                .padding(.top, 6)

            Text("Start tmux or open iTerm and the room will print here.")
                .font(HUDType.body(12).italic())
                .foregroundStyle(HUDChrome.inkMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .padding(.top, 6)

            // Hint chip — preserves the operator affordance
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text("tmux")
                    .font(HUDType.mono(10, weight: .semibold))
                    .tracking(0.5)
                    .foregroundStyle(HUDChrome.accent)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .background(
                        RoundedRectangle(cornerRadius: 2.5)
                            .fill(HUDChrome.accentSoft)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 2.5)
                            .stroke(HUDChrome.accent.opacity(0.4), lineWidth: 0.5)
                    )

                Text("new -s vantage")
                    .font(HUDType.mono(10))
                    .foregroundStyle(HUDChrome.inkFaint)
            }
            .padding(.top, 16)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Row (teletype)
//
// A printed tape line. Layout:
//
//   [ glyph ]  Big-mono-name                          [ LIVE ]  ago
//              KIND  ·  4 WINS                                       ↦  attached cursor block
//
// Selected (first) row gets a lime hairline on the left, a canvas-lift
// fill, and a hue-rule at the bottom. The cursor block only renders on
// attached sessions and animates by default.

private struct SessionRow: View {
    let session: ScoutSession
    let isSelected: Bool
    var onTap: () -> Void = {}

    @State private var hovered = false

    private var rowFill: Color {
        if isSelected { return HUDChrome.canvasLift.opacity(0.45) }
        if hovered    { return HUDChrome.canvasLift.opacity(0.28) }
        return Color.clear
    }

    private var glyphColor: Color {
        session.attached ? HUDChrome.accent : HUDChrome.inkMuted
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            // Name line — glyph + name take all available width; ago at right
            HStack(alignment: .firstTextBaseline, spacing: 9) {
                SessionKindGlyph(kind: session.kind, color: glyphColor)
                    .frame(width: 16, height: 14)
                    .alignmentGuide(.firstTextBaseline) { d in d[VerticalAlignment.center] + 6 }

                Text(session.name)
                    .font(HUDType.mono(13, weight: .semibold))
                    .foregroundStyle(HUDChrome.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .layoutPriority(1)

                if session.attached {
                    CursorBlock()
                        .alignmentGuide(.firstTextBaseline) { d in d[VerticalAlignment.center] + 5 }
                }

                Spacer(minLength: 6)

                if let ago = session.createdAgo {
                    Text(ago)
                        .font(HUDType.mono(10, weight: .medium))
                        .monospacedDigit()
                        .foregroundStyle(HUDChrome.inkMuted)
                        .fixedSize()
                }
            }

            // Meta line — single ink-tone, no rainbow
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                Text(session.kind.rawValue.uppercased())
                    .font(HUDType.mono(10, weight: .bold))
                    .foregroundStyle(session.attached ? HUDChrome.accent : HUDChrome.inkDeep)

                metaDot

                Text("\(session.windows) \(session.windows == 1 ? "WIN" : "WINS")")
                    .font(HUDType.mono(10, weight: .semibold))
                    .foregroundStyle(HUDChrome.inkDeep)

                if session.attached {
                    metaDot
                    Text("ATTACHED")
                        .font(HUDType.mono(10, weight: .bold))
                        .foregroundStyle(HUDChrome.accent)
                }

                Spacer(minLength: 0)
            }
            .padding(.leading, 25)

            // Latest action snippet — last non-empty line from the pane.
            // tmux only for now; iTerm/Terminal don't expose this cleanly.
            if let snippet = session.latestAction, !snippet.isEmpty {
                Text(snippet)
                    .font(HUDType.mono(10))
                    .foregroundStyle(HUDChrome.inkMuted)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .padding(.leading, 25)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 11)
        .padding(.bottom, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(rowFill)
        .overlay(alignment: .leading) {
            if isSelected {
                Rectangle()
                    .fill(HUDChrome.accent)
                    .frame(width: 1.5)
            }
        }
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(HUDChrome.borderSoft)
                .frame(height: 0.5)
                .padding(.horizontal, 16)
        }
        .contentShape(Rectangle())
        .onHover { hovered = $0 }
        .onTapGesture(perform: onTap)
        .contextMenu {
            Button("Open in terminal") { onTap() }
            Button("Copy session name") {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(session.name, forType: .string)
            }
            if session.kind == .tmux {
                Button("Copy attach command") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString("tmux attach -t \(session.name)", forType: .string)
                }
            }
        }
    }

    private var metaDot: some View {
        Circle()
            .fill(HUDChrome.inkFaint)
            .frame(width: 1.8, height: 1.8)
    }
}

// MARK: - Cursor block
//
// A real blinking cursor — animates 1Hz between on and off. The only
// literal-terminal flourish in the HUD; earns its place because the
// Sessions view is a terminal surface.

private struct CursorBlock: View {
    @State private var on = true

    var body: some View {
        Rectangle()
            .fill(HUDChrome.accent)
            .frame(width: 6, height: 12)
            .opacity(on ? 0.85 : 0.1)
            .onAppear {
                withAnimation(.easeInOut(duration: 0.55).repeatForever(autoreverses: true)) {
                    on.toggle()
                }
            }
    }
}

// MARK: - Kind glyphs (hand-drawn, scout-only colors)

private struct SessionKindGlyph: View {
    let kind: SessionKind
    let color: Color

    var body: some View {
        switch kind {
        case .tmux:
            // Quad of stacked rectangles — multiplexed panes
            Canvas { ctx, size in
                let style = StrokeStyle(lineWidth: 1, lineJoin: .miter)
                var outer = Path()
                outer.addRect(CGRect(x: 1.5, y: 1.5, width: 13, height: 11))

                var split = Path()
                split.move(to: CGPoint(x: 8, y: 1.5))
                split.addLine(to: CGPoint(x: 8, y: 12.5))
                split.move(to: CGPoint(x: 8, y: 7))
                split.addLine(to: CGPoint(x: 14.5, y: 7))

                var pane = Path()
                pane.addRect(CGRect(x: 8.5, y: 7.5, width: 5.5, height: 4.5))
                ctx.fill(pane, with: .color(color.opacity(0.32)))

                ctx.stroke(outer, with: .color(color), style: style)
                ctx.stroke(split, with: .color(color), style: style)
            }
        case .iterm:
            // Prompt chevron + cursor block
            Canvas { ctx, size in
                let style = StrokeStyle(lineWidth: 1.4, lineCap: .round, lineJoin: .round)
                var chev = Path()
                chev.move(to: CGPoint(x: 2.5, y: 3.5))
                chev.addLine(to: CGPoint(x: 7, y: 7))
                chev.addLine(to: CGPoint(x: 2.5, y: 10.5))
                ctx.stroke(chev, with: .color(color), style: style)

                var cursor = Path()
                cursor.addRect(CGRect(x: 8.5, y: 9.6, width: 5, height: 1.6))
                ctx.fill(cursor, with: .color(color))
            }
        case .terminal:
            // Window frame + tiny chevron
            Canvas { ctx, size in
                let style = StrokeStyle(lineWidth: 1, lineJoin: .miter)
                var outer = Path()
                outer.addRect(CGRect(x: 1.5, y: 2.5, width: 13, height: 9))
                ctx.stroke(outer, with: .color(color), style: style)

                var titleRule = Path()
                titleRule.move(to: CGPoint(x: 1.5, y: 5))
                titleRule.addLine(to: CGPoint(x: 14.5, y: 5))
                ctx.stroke(titleRule, with: .color(color.opacity(0.55)),
                           style: StrokeStyle(lineWidth: 0.75))

                var chev = Path()
                chev.move(to: CGPoint(x: 3.5, y: 7))
                chev.addLine(to: CGPoint(x: 5.5, y: 8.5))
                chev.addLine(to: CGPoint(x: 3.5, y: 10))
                ctx.stroke(chev, with: .color(color),
                           style: StrokeStyle(lineWidth: 1, lineCap: .round, lineJoin: .round))
            }
        }
    }
}

// MARK: - Empty-state mark
//
// A small printed terminal-room glyph — frame + cursor mark. Reads as a
// closed terminal door.

private struct EmptyTerminalMark: View {
    var body: some View {
        Canvas { ctx, size in
            let style = StrokeStyle(lineWidth: 1, lineJoin: .miter)
            let c = HUDChrome.inkFaint

            var outer = Path()
            outer.addRect(CGRect(
                x: 1, y: 1,
                width: size.width - 2, height: size.height - 2
            ))
            ctx.stroke(outer, with: .color(c), style: style)

            for cx in stride(from: 4.0, to: 14.5, by: 4.0) {
                let dot = CGRect(x: cx, y: 4, width: 1.8, height: 1.8)
                ctx.fill(Path(ellipseIn: dot), with: .color(HUDChrome.borderStrong))
            }

            var rule = Path()
            rule.move(to: CGPoint(x: 1, y: 8.5))
            rule.addLine(to: CGPoint(x: size.width - 1, y: 8.5))
            ctx.stroke(rule, with: .color(HUDChrome.borderSoft),
                       style: StrokeStyle(lineWidth: 0.5))

            // Empty-prompt placeholder
            let py = size.height / 2 + 5
            var prompt = Path()
            prompt.move(to: CGPoint(x: 5, y: py))
            prompt.addLine(to: CGPoint(x: 10, y: py))
            ctx.stroke(prompt, with: .color(c),
                       style: StrokeStyle(lineWidth: 1, lineCap: .round))

            let cursor = CGRect(x: 12, y: py - 2, width: 2.5, height: 4.5)
            ctx.fill(Path(cursor), with: .color(HUDChrome.borderStrong))
        }
    }
}
