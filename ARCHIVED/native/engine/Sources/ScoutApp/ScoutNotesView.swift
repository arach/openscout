import ScoutCore
import SwiftUI

struct ScoutNotesView: View {
    @Bindable var viewModel: ScoutShellViewModel

    @State private var title = ""
    @State private var noteBody = ""
    @State private var tags = ""
    @State private var linkedAgentIDs = Set<String>()

    var body: some View {
        ScoutPage {
            ScoutPageHeader(
                eyebrow: "Notes",
                title: "Context That Survives",
                subtitle: "Turn raw thinking into reusable context for compose flows, workflows, and future agent handoffs.",
                actions: AnyView(
                    HStack(spacing: 10) {
                        Button("New Note") {
                            viewModel.createNote()
                            syncEditorFromSelection()
                        }
                        .buttonStyle(ScoutButtonStyle(tone: .primary))

                        Button("Save") {
                            saveCurrentNote()
                        }
                        .buttonStyle(ScoutButtonStyle())
                        .disabled(viewModel.selectedNote == nil)
                    }
                )
            )

            HSplitView {
                noteList
                    .frame(minWidth: 260, idealWidth: 300, maxWidth: 340)

                editorPane
                    .frame(minWidth: 520)
            }
            .frame(minHeight: 620)
        }
        .onAppear {
            syncEditorFromSelection()
        }
        .onChange(of: viewModel.selectedNoteID) { _, _ in
            syncEditorFromSelection()
        }
    }

    private var noteList: some View {
        ScoutSection(
            title: "Library",
            subtitle: "\(viewModel.notes.count) saved notes"
        ) {
            if viewModel.notes.isEmpty {
                Text("No notes yet. Capture context here before you start composing for agents.")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(ScoutTheme.inkSecondary)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        ForEach(viewModel.notes) { note in
                            Button {
                                viewModel.selectedNoteID = note.id
                            } label: {
                                NoteRow(
                                    note: note,
                                    isSelected: viewModel.selectedNoteID == note.id
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
    }

    private var editorPane: some View {
        ScoutSection(
            title: "Editor",
            subtitle: "Treat notes as durable operator context, not scratch text."
        ) {
            if viewModel.selectedNote == nil {
                Text("Select a note to edit or create a new one.")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(ScoutTheme.inkSecondary)
            } else {
                VStack(alignment: .leading, spacing: 16) {
                    TextField("Note title", text: $title)
                        .textFieldStyle(.plain)
                        .font(.system(size: 21, weight: .medium))
                        .foregroundStyle(ScoutTheme.ink)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                        .background(
                            RoundedRectangle(cornerRadius: 10)
                                .fill(ScoutTheme.surfaceStrong)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 10)
                                        .strokeBorder(ScoutTheme.border, lineWidth: 1)
                                )
                        )

                    ScoutEditor(
                        title: "Body",
                        placeholder: "Capture useful context, constraints, product instincts, or exact instructions worth reusing later.",
                        text: $noteBody,
                        minHeight: 320,
                        subtitle: "Write in a more natural notes style. Click once to focus and type directly.",
                        showsLineNumbers: false,
                        showsStatusBar: false
                    )

                    HStack(alignment: .top, spacing: 18) {
                        VStack(alignment: .leading, spacing: 8) {
                            ScoutSubsectionHeader("Tags")

                            TextField("product, ux, agent brief", text: $tags)
                                .textFieldStyle(.roundedBorder)
                        }

                        VStack(alignment: .leading, spacing: 8) {
                            ScoutSubsectionHeader("Linked Agents")

                            FlowAgentPicker(
                                agents: viewModel.agentProfiles,
                                selection: $linkedAgentIDs
                            )
                        }
                    }

                    HStack(spacing: 10) {
                        Button("Save Note") {
                            saveCurrentNote()
                        }
                        .buttonStyle(ScoutButtonStyle(tone: .primary))

                        Button("Use In Compose") {
                            saveCurrentNote()
                            viewModel.createDraftFromSelectedNote()
                            viewModel.selectedRoute = .console
                        }
                        .buttonStyle(ScoutButtonStyle())
                    }
                }
            }
        }
    }

    private func syncEditorFromSelection() {
        guard let note = viewModel.selectedNote else {
            title = ""
            noteBody = ""
            tags = ""
            linkedAgentIDs = []
            return
        }

        title = note.title
        noteBody = note.body
        tags = note.tags.joined(separator: ", ")
        linkedAgentIDs = Set(note.linkedAgentIDs)
    }

    private func saveCurrentNote() {
        guard let note = viewModel.selectedNote else {
            return
        }

        viewModel.saveNote(
            id: note.id,
            title: title,
            body: noteBody,
            tagsText: tags,
            linkedAgentIDs: Array(linkedAgentIDs)
        )
    }
}

private struct NoteRow: View {
    let note: ScoutNote
    let isSelected: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(note.title)
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(ScoutTheme.ink)
                .lineLimit(1)

            Text(note.body.isEmpty ? "No content yet." : note.body)
                .font(.system(size: 12))
                .foregroundStyle(ScoutTheme.inkSecondary)
                .lineLimit(3)

            Text(note.updatedAt.formatted(date: .abbreviated, time: .shortened))
                .font(.system(size: 10, weight: .medium, design: .monospaced))
                .foregroundStyle(ScoutTheme.inkMuted)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(isSelected ? ScoutTheme.selection : ScoutTheme.surfaceStrong)
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .strokeBorder(isSelected ? ScoutTheme.accent.opacity(0.2) : ScoutTheme.border, lineWidth: 1)
                )
        )
    }
}
