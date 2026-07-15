import ScoutAppCore
import SwiftUI

struct HUDRunnerProjectSearch: View {
    @ObservedObject private var runner = HUDRunnerState.shared
    let focus: HUDRunnerFocusBinding

    var body: some View {
        HUDRunnerDisclosurePanel {
            VStack(spacing: 8) {
                HUDRunnerDisclosureHeader(
                    title: "FIND A PROJECT",
                    detail: "Type to filter",
                    focus: focus
                )
                searchBar
                results
            }
            .padding(7)
        }
    }

    private var searchBar: some View {
        HStack(spacing: 6) {
            HStack(spacing: 7) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(HUDChrome.inkFaint)
                TextField(
                    "Project name or path",
                    text: $runner.projectSearchQuery
                )
                .textFieldStyle(.plain)
                .font(HUDType.body(12, weight: .medium))
                .foregroundStyle(HUDChrome.ink)
                .onChange(of: runner.projectSearchQuery) { _, _ in
                    runner.projectCursorIndex = 0
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 42)
            .background(HUDChrome.canvasAlt.opacity(0.74))
            .overlay(
                RoundedRectangle(cornerRadius: 11, style: .continuous)
                    .stroke(
                        focus.wrappedValue == .projectSearch
                            ? HUDChrome.borderStrong
                            : HUDChrome.borderSoft,
                        lineWidth: focus.wrappedValue == .projectSearch ? 1.25 : 0.75
                    )
            )
            .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
            .focused(focus, equals: .projectSearch)
            .accessibilityLabel("Project search")

            Button(action: runner.browseForDirectory) {
                Image(systemName: "folder.badge.plus")
                    .font(.system(size: 13, weight: .semibold))
                    .frame(width: 42, height: 42)
            }
            .buttonStyle(
                HUDRunnerToolbarButtonStyle(
                    isActive: false,
                    isFocused: focus.wrappedValue == .browseDirectory
                )
            )
            .focused(focus, equals: .browseDirectory)
            .help("Choose a project folder")
            .accessibilityLabel("Choose a project folder")
        }
    }

    @ViewBuilder
    private var results: some View {
        let matches = runner.projectMatches(limit: 3)
        if matches.isEmpty {
            HStack(spacing: 7) {
                Image(systemName: "folder")
                Text(runner.isLoading ? "Loading projects…" : "No matching projects")
            }
            .font(HUDType.body(12))
            .foregroundStyle(HUDChrome.inkFaint)
            .frame(maxWidth: .infinity, minHeight: 160)
        } else {
            VStack(spacing: 8) {
                ForEach(matches) { project in
                    HUDRunnerProjectOptionRow(
                        project: project,
                        focus: focus
                    )
                }
            }
        }
    }
}
