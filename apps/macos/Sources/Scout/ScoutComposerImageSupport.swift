import SwiftUI
#if os(macOS)
import AppKit

/// Catches ⌘V at the AppKit level so an image on the pasteboard is staged in
/// the composer even while the text field holds focus. A focused field's editor
/// otherwise swallows ⌘V as an (empty) text paste — which is why pasting a
/// screenshot felt like it did nothing. The local monitor runs before that
/// dispatch, so we can claim the event when there's an image to stage.
struct ImagePasteCatcher: NSViewRepresentable {
    var isActive: () -> Bool
    /// Returns true if the images were staged (and the paste should be consumed).
    var onPasteImages: ([ScoutComposerImage]) -> Bool

    func makeNSView(context: Context) -> NSView {
        context.coordinator.install()
        return NSView(frame: .zero)
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        // Refresh the closures each render so they read current view state.
        context.coordinator.isActive = isActive
        context.coordinator.onPasteImages = onPasteImages
    }

    static func dismantleNSView(_ nsView: NSView, coordinator: Coordinator) {
        coordinator.uninstall()
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(isActive: isActive, onPasteImages: onPasteImages)
    }

    final class Coordinator {
        var isActive: () -> Bool
        var onPasteImages: ([ScoutComposerImage]) -> Bool
        private var monitor: Any?

        init(
            isActive: @escaping () -> Bool,
            onPasteImages: @escaping ([ScoutComposerImage]) -> Bool
        ) {
            self.isActive = isActive
            self.onPasteImages = onPasteImages
        }

        func install() {
            guard monitor == nil else { return }
            monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
                guard let self, self.isActive() else { return event }
                guard event.modifierFlags.contains(.command),
                      event.charactersIgnoringModifiers?.lowercased() == "v" else { return event }
                // Only claim ⌘V when the pasteboard actually holds an image;
                // otherwise let the normal text paste proceed untouched.
                let images = ScoutImageIntake.fromPasteboard()
                guard !images.isEmpty else { return event }
                return self.onPasteImages(images) ? nil : event
            }
        }

        func uninstall() {
            if let monitor {
                NSEvent.removeMonitor(monitor)
            }
            monitor = nil
        }
    }
}

/// Centered, dimmed full-image preview (lightbox) for a staged composer image.
/// Dismisses on background tap, the close button, or Esc.
struct ScoutImageLightbox: View {
    let image: ScoutComposerImage
    let onDismiss: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.74)
                .ignoresSafeArea()
                .contentShape(Rectangle())
                .onTapGesture(perform: onDismiss)

            if let nsImage = NSImage(data: image.data) {
                Image(nsImage: nsImage)
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(48)
                    .shadow(color: .black.opacity(0.5), radius: 30, y: 8)
                    .accessibilityLabel(image.fileName)
            }

            VStack {
                HStack {
                    Spacer()
                    Button(action: onDismiss) {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 22))
                            .foregroundStyle(.white, .black.opacity(0.45))
                    }
                    .buttonStyle(.plain).scoutPointerCursor()
                    .help("Close preview")
                }
                Spacer()
            }
            .padding(24)
        }
        .onExitCommand(perform: onDismiss)
        .transition(.opacity)
    }
}
#endif
