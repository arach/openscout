import ScoutCore
import SwiftUI

struct FlowAgentPicker: View {
    let agents: [ScoutAgentProfile]
    @Binding var selection: Set<String>

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(agents) { agent in
                Button {
                    if selection.contains(agent.id) {
                        selection.remove(agent.id)
                    } else {
                        selection.insert(agent.id)
                    }
                } label: {
                    HStack(spacing: 10) {
                        Image(systemName: agent.systemImage)
                            .frame(width: 16)

                        VStack(alignment: .leading, spacing: 2) {
                            Text(agent.name)
                                .font(.system(size: 13, weight: .semibold))
                            Text(agent.role)
                                .font(.system(size: 11, weight: .medium))
                                .foregroundStyle(ScoutTheme.inkMuted)
                        }

                        Spacer()

                        if selection.contains(agent.id) {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(ScoutTheme.accent)
                        }
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 8)
                            .fill(selection.contains(agent.id) ? ScoutTheme.selection : ScoutTheme.surfaceStrong)
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .strokeBorder(ScoutTheme.border, lineWidth: 1)
                            )
                    )
                }
                .buttonStyle(.plain)
            }
        }
    }
}
