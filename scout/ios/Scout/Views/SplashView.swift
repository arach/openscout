// SplashView — Brief pre-splash with logo and mono wordmark.

import SwiftUI

struct SplashView: View {
    var body: some View {
        ZStack {
            ScoutColors.backgroundAdaptive
                .ignoresSafeArea()

            VStack(spacing: 20) {
                Image("SplashLogo")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(width: 80, height: 80)
                    .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

                Text("Scout")
                    .font(.system(.title3, design: .monospaced))
                    .fontWeight(.medium)
                    .foregroundStyle(ScoutColors.textPrimary)
            }
        }
    }
}
