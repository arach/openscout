import SwiftUI

struct ScoutPage<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                content
            }
            .padding(24)
        }
        .background(ScoutTheme.canvas)
    }
}

struct ScoutPageHeader: View {
    let eyebrow: String?
    let title: String
    let subtitle: String?
    let actions: AnyView?

    init(
        eyebrow: String? = nil,
        title: String,
        subtitle: String? = nil,
        actions: AnyView? = nil
    ) {
        self.eyebrow = eyebrow
        self.title = title
        self.subtitle = subtitle
        self.actions = actions
    }

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                if let eyebrow {
                    Text(eyebrow)
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .textCase(.uppercase)
                        .tracking(0.8)
                        .foregroundStyle(ScoutTheme.inkMuted)
                }

                Text(title)
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(ScoutTheme.ink)

                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(ScoutTheme.inkSecondary)
                        .frame(maxWidth: 640, alignment: .leading)
                }
            }

            Spacer(minLength: 0)

            if let actions {
                actions
            }
        }
    }
}
