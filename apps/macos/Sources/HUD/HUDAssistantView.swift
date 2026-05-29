import AppKit
import SwiftUI

// Assistant tab — slot 5. Native port of
// design/studio/components/hud/HudAssistant.tsx.
//
// DM-style desktop view of the same Scout that lives on iOS
// (project-hud-slot5-scout-surface). One persistent thread; the tab
// label stays neutral while the robot-head glyph carries the brand on
// the masthead and on every Scout message.
//
// Compact / Medium: single-column thread + small "DESKTOP THREAD"
// eyebrow header with ONLINE indicator.
// Large: two-pane — thread left, context rail right (QUICK commands,
// ON YOU mentions, RECENT ASKS).
//
// Inline message rendering:
//   text     → studio ink
//   mention  → scout accent (lime)
//   cmd      → /command in lime chip
//   path     → path hue (cool teal)
//   code     → ink + medium weight, mono

// MARK: - Span + Message model

enum HUDAssistantSpan {
    case text(String)
    case mention(String)
    case cmd(String)
    case path(String)
    case code(String)
}

enum HUDAssistantSource {
    case scout
    case operatorYou
}

struct HUDAssistantMessage: Identifiable {
    let id: String
    let source: HUDAssistantSource
    let at: String
    let body: [HUDAssistantSpan]
}

// MARK: - Main view

struct HUDAssistantView: View {
    @ObservedObject private var state = HUDState.shared
    @ObservedObject private var compose = HudComposeService.shared

    var body: some View {
        Group {
            switch state.size {
            case .compact:           compactBody
            case .medium, .large:    largeBody
            }
        }
    }

    private var horizontalPad: CGFloat {
        state.size == .compact ? 16 : 20
    }

    private func scrollToLatest(proxy: ScrollViewProxy) {
        guard let last = compose.assistantThread.last else { return }
        withAnimation(.easeOut(duration: 0.18)) {
            proxy.scrollTo(last.id, anchor: .bottom)
        }
    }

    // MARK: - Compact

    private var compactBody: some View {
        VStack(spacing: 0) {
            ThreadHeader(size: state.size)
            if compose.assistantThread.isEmpty {
                AssistantEmptyState()
            } else {
                // Top-anchored for short threads (a couple of turns hug
                // the top of the available space, not the dock); auto-
                // scroll to the freshest message on each new turn so long
                // replies pull the operator to where the action is.
                ScrollViewReader { proxy in
                    ScrollView(.vertical, showsIndicators: false) {
                        Thread(messages: compose.assistantThread, size: state.size)
                            .padding(.horizontal, horizontalPad)
                            .padding(.vertical, 10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .defaultScrollAnchor(.top)
                    .onChange(of: compose.assistantThread.count) { _, _ in
                        scrollToLatest(proxy: proxy)
                    }
                }
            }
        }
    }

    // MARK: - Large

    private var largeBody: some View {
        HStack(spacing: 0) {
            VStack(spacing: 0) {
                ThreadHeader(size: .large)
                if compose.assistantThread.isEmpty {
                    AssistantEmptyState()
                } else {
                    ScrollViewReader { proxy in
                        ScrollView(.vertical, showsIndicators: false) {
                            Thread(messages: compose.assistantThread, size: .large)
                                .padding(.horizontal, 20)
                                .padding(.vertical, 12)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .defaultScrollAnchor(.top)
                        .onChange(of: compose.assistantThread.count) { _, _ in
                            scrollToLatest(proxy: proxy)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity)

            Rectangle().fill(HUDChrome.border).frame(width: 0.5)

            ContextRail()
                .frame(width: 300)
        }
    }
}

// MARK: - Empty state

/// Shown in the Assistant tab when the operator hasn't composed anything
/// this session. Mirrors the empty pattern used by Tail/Sessions/Activity
/// — eyebrow + headline + one-line hint — so the surfaces feel like a
/// family.
private struct AssistantEmptyState: View {
    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 24)

            HUDEyebrow(text: "THREAD  ·  NEW", color: HUDChrome.inkFaint)
                .padding(.top, 18)

            Text("Talk to scout.")
                .font(HUDType.body(15, weight: .semibold))
                .foregroundStyle(HUDChrome.ink)
                .padding(.top, 6)

            Text("Tap the mic or type below. Your messages land here.")
                .font(HUDType.body(12))
                .foregroundStyle(HUDChrome.inkMuted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .padding(.top, 6)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Header

private struct ThreadHeader: View {
    let size: HUDSize
    @ObservedObject private var compose = HudComposeService.shared

    private var horizontalPad: CGFloat {
        size == .large ? 20 : 16
    }

    // Use the active thread name once it loads from the backend. Until
    // then, fall back to "default" — the only thread stage 1 ships.
    private var headerLabel: String {
        let name = compose.activeThread?.name ?? "default"
        return "DESKTOP THREAD  ·  \(name.uppercased())"
    }

    var body: some View {
        HStack(spacing: 0) {
            HUDEyebrow(text: headerLabel, color: HUDChrome.inkFaint)
            Spacer()
            HStack(spacing: 5) {
                Circle()
                    .fill(HUDChrome.accent)
                    .frame(width: 5, height: 5)
                Text("ONLINE")
                    .font(HUDType.mono(10, weight: .bold))
                    .tracking(HUDType.eyebrowTracking)
                    .foregroundStyle(HUDChrome.ink)
            }
        }
        .padding(.horizontal, horizontalPad)
        .padding(.vertical, 8)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(HUDChrome.border)
                .frame(height: 0.5)
        }
    }
}

// MARK: - Thread

private struct Thread: View {
    let messages: [HUDAssistantMessage]
    let size: HUDSize

    /// True when the operator has sent a message and scoutbot hasn't
    /// replied yet — drives the "thinking" indicator under the thread.
    private var awaitingReply: Bool {
        messages.last?.source == .operatorYou
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(messages) { m in
                MessageBlock(message: m, size: size)
                    .id(m.id)
            }
            if awaitingReply {
                ThinkingIndicator()
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .animation(.easeOut(duration: 0.18), value: awaitingReply)
    }
}

// "scoutbot is thinking" — quiet status row that appears between the
// operator's latest send and scoutbot's reply. Three dots cycle through
// opacity so it's clearly alive without grabbing attention.
private struct ThinkingIndicator: View {
    @State private var phase = 0
    private let timer = Timer.publish(every: 0.42, on: .main, in: .common).autoconnect()

    var body: some View {
        HStack(spacing: 6) {
            RobotGlyphShape()
                .stroke(HUDChrome.accent.opacity(0.7), style: StrokeStyle(lineWidth: 1, lineCap: .round, lineJoin: .round))
                .frame(width: 12, height: 12)

            Text("@scout")
                .font(HUDType.mono(11, weight: .semibold))
                .foregroundStyle(HUDChrome.accent.opacity(0.7))

            HStack(spacing: 2) {
                ForEach(0..<3) { i in
                    Circle()
                        .fill(HUDChrome.accent)
                        .frame(width: 3, height: 3)
                        .opacity(phase == i ? 1.0 : 0.25)
                }
            }
            .padding(.leading, 2)

            Spacer()
        }
        .onReceive(timer) { _ in phase = (phase + 1) % 3 }
    }
}

private struct MessageBlock: View {
    let message: HUDAssistantMessage
    let size: HUDSize

    private var isScout: Bool { message.source == .scout }
    private var sourceLabel: String { isScout ? "scout" : "you" }
    private var sourceColor: Color {
        isScout ? HUDChrome.accent : HUDChrome.ink
    }
    // Mono throughout the thread for the cockpit-terminal voice; sized
    // down ~1pt from the sans-equivalent because mono reads heavier.
    private var bodyFontSize: CGFloat {
        size == .compact ? 11 : (size == .medium ? 11.5 : 12)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .center, spacing: 6) {
                Group {
                    if isScout {
                        RobotGlyphShape()
                            .stroke(sourceColor, style: StrokeStyle(lineWidth: 1, lineCap: .round, lineJoin: .round))
                    } else {
                        YouGlyphShape()
                            .stroke(sourceColor, style: StrokeStyle(lineWidth: 1.2, lineCap: .round, lineJoin: .round))
                    }
                }
                .frame(width: 12, height: 12)

                Text("@" + sourceLabel)
                    .font(HUDType.mono(11, weight: .semibold))
                    .foregroundStyle(sourceColor)

                Spacer()

                Text(message.at)
                    .font(HUDType.mono(10))
                    .monospacedDigit()
                    .foregroundStyle(HUDChrome.inkFaint)
            }

            Text(buildAttributedBody(spans: message.body, baseSize: bodyFontSize))
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
                .multilineTextAlignment(.leading)
                // Force-fill the column so long unbreakable tokens (paths,
                // URLs) wrap at character boundaries instead of leaking out
                // the HStack ideal-width and silently truncating the tail.
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.leading, 18)
        }
    }
}

// Compose an AttributedString out of the message spans. All spans use
// mono now (cockpit voice) — kind differences live in weight + color
// rather than font family.
private func buildAttributedBody(spans: [HUDAssistantSpan], baseSize: CGFloat) -> AttributedString {
    let pathColor = Color(red: 0.420, green: 0.720, blue: 0.700)
    var out = AttributedString("")
    for span in spans {
        switch span {
        case .text(let s):
            var seg = AttributedString(s)
            seg.font = HUDType.mono(baseSize)
            seg.foregroundColor = HUDChrome.ink
            out += seg
        case .mention(let s):
            var seg = AttributedString(s)
            seg.font = HUDType.mono(baseSize, weight: .semibold)
            seg.foregroundColor = HUDChrome.accent
            out += seg
        case .cmd(let s):
            // Inline command spans get a chip-y treatment via spacing +
            // semibold weight in accent. A true bordered chip isn't
            // expressible inside AttributedString without breaking
            // line-wrap, so we lean on weight + color and accept it as
            // inline-text rather than a true badge.
            var seg = AttributedString(" \(s) ")
            seg.font = HUDType.mono(baseSize, weight: .semibold)
            seg.foregroundColor = HUDChrome.accent
            out += seg
        case .path(let s):
            var seg = AttributedString(s)
            seg.font = HUDType.mono(baseSize)
            seg.foregroundColor = pathColor
            out += seg
        case .code(let s):
            var seg = AttributedString(s)
            seg.font = HUDType.mono(baseSize, weight: .medium)
            seg.foregroundColor = HUDChrome.ink
            out += seg
        }
    }
    return out
}

// MARK: - Context rail (large only)

private struct ContextRail: View {
    var body: some View {
        ScrollView(.vertical, showsIndicators: false) {
            VStack(alignment: .leading, spacing: 18) {
                RailSection(label: "QUICK") {
                    RailCmd(cmd: "/help", hint: "all commands")
                    RailCmd(cmd: "/find", hint: "agent by name or work")
                    RailCmd(cmd: "/spin", hint: "start a new agent")
                    RailCmd(cmd: "/recent", hint: "last 24h activity")
                }
                RailSection(label: "ON YOU") {
                    RailMention(name: "hudson", detail: "compile error · 7m")
                }
                RailSection(label: "RECENT ASKS") {
                    RailRecent(text: "status pass on hudson", at: "09:14")
                    RailRecent(text: "open Sources/Mesh/PresenceCache.swift", at: "09:15")
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct RailSection<Content: View>: View {
    let label: String
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HUDEyebrow(text: label, color: HUDChrome.inkFaint)
            VStack(alignment: .leading, spacing: 3) {
                content
            }
        }
    }
}

private struct RailCmd: View {
    let cmd: String
    let hint: String
    @State private var hovered = false

    var body: some View {
        Button(action: {}) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(cmd)
                    .font(HUDType.mono(11, weight: .semibold))
                    .foregroundStyle(HUDChrome.accent)
                Text(hint)
                    .font(HUDType.body(11))
                    .foregroundStyle(HUDChrome.inkMuted)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(hovered ? HUDChrome.canvasLift.opacity(0.30) : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovered = $0 }
    }
}

private struct RailMention: View {
    let name: String
    let detail: String
    @State private var hovered = false

    var body: some View {
        Button(action: {}) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("@" + name)
                    .font(HUDType.mono(11, weight: .semibold))
                    .foregroundStyle(HUDChrome.accent)
                Text(detail)
                    .font(HUDType.mono(10))
                    .foregroundStyle(HUDChrome.inkFaint)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 3)
            .background(hovered ? HUDChrome.canvasLift.opacity(0.30) : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovered = $0 }
    }
}

private struct RailRecent: View {
    let text: String
    let at: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(text)
                .font(HUDType.body(11))
                .foregroundStyle(HUDChrome.inkMuted)
                .lineLimit(1)
                .truncationMode(.tail)
            Spacer(minLength: 4)
            Text(at)
                .font(HUDType.mono(10))
                .monospacedDigit()
                .foregroundStyle(HUDChrome.inkFaint)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
    }
}

// MARK: - Glyphs (translated from studio SVG)

/// Robot-head sigil — rounded square head, two dot eyes, antenna with
/// finial, mouth, and two foot ticks. Stroked in currentColor by the
/// caller's `.stroke(…)`; the eyes + finial dot get filled by the
/// shape's even-odd path so a single stroke modifier paints the lot.
struct RobotGlyphShape: Shape {
    func path(in rect: CGRect) -> Path {
        // SVG viewBox is 0..14; map proportionally.
        let s = min(rect.width, rect.height) / 14.0
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x * s, y: rect.minY + y * s)
        }

        var path = Path()

        // Antenna stem
        path.move(to: p(7, 1.5))
        path.addLine(to: p(7, 3))

        // Antenna finial dot (small circle, ~0.7 radius)
        let dotR: CGFloat = 0.7 * s
        let dotCx = rect.minX + 7 * s
        let dotCy = rect.minY + 1.2 * s
        path.addEllipse(in: CGRect(
            x: dotCx - dotR, y: dotCy - dotR,
            width: dotR * 2, height: dotR * 2
        ))

        // Head — rounded rect
        let headRect = CGRect(
            x: rect.minX + 2.5 * s,
            y: rect.minY + 3.2 * s,
            width: 9 * s,
            height: 7.6 * s
        )
        let headR: CGFloat = 1.8 * s
        path.addRoundedRect(in: headRect, cornerSize: CGSize(width: headR, height: headR))

        // Eyes — two filled-circle silhouettes via stroked-with-fill
        // (drawn as small ellipses; the caller's .stroke paints them
        // as outlines, but at this scale they read as dots regardless).
        let eyeR: CGFloat = 0.85 * s
        for cx in [5.2, 8.8] {
            let cy = rect.minY + 6.6 * s
            let ex = rect.minX + CGFloat(cx) * s
            path.addEllipse(in: CGRect(
                x: ex - eyeR, y: cy - eyeR,
                width: eyeR * 2, height: eyeR * 2
            ))
        }

        // Mouth
        path.move(to: p(5.4, 8.8))
        path.addLine(to: p(8.6, 8.8))

        // Feet — two ticks
        path.move(to: p(4.5, 11.4))
        path.addLine(to: p(4.5, 12.4))
        path.move(to: p(9.5, 11.4))
        path.addLine(to: p(9.5, 12.4))

        return path
    }
}

/// Operator marker — a small head + shoulders silhouette. Reads as a
/// person at 12px so it pairs with the robot glyph as a clear
/// "human vs. machine" distinction in the assistant thread.
struct YouGlyphShape: Shape {
    func path(in rect: CGRect) -> Path {
        // viewBox is 0..14; same proportional layout as RobotGlyphShape
        // so the two glyphs share visual mass at the same frame size.
        let s = min(rect.width, rect.height) / 14.0
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x * s, y: rect.minY + y * s)
        }

        var path = Path()

        // Head — small circle centered on top half
        let headR: CGFloat = 2.1 * s
        let headCx = rect.minX + 7 * s
        let headCy = rect.minY + 4.4 * s
        path.addEllipse(in: CGRect(
            x: headCx - headR, y: headCy - headR,
            width: headR * 2, height: headR * 2
        ))

        // Shoulders — gentle arc that reads as a torso outline
        path.move(to: p(2.4, 12.2))
        path.addCurve(
            to: p(11.6, 12.2),
            control1: p(3.4, 8.2),
            control2: p(10.6, 8.2)
        )

        return path
    }
}
