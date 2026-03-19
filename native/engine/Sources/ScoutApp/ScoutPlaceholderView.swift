import SwiftUI

struct ScoutPlaceholderView: View {
    let title: String
    let summary: String

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.system(size: 36, weight: .bold))
                .foregroundStyle(ScoutTheme.ink)

            Text(summary)
                .foregroundStyle(ScoutTheme.inkMuted)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(24)
        .background(ScoutTheme.canvas)
    }
}
