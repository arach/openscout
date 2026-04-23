// ScoutSearchField — Single-line UITextField that suppresses the system keyboard.
// Used with ScoutKeyboardView for in-app text input without system keyboard.

import SwiftUI
import UIKit

struct ScoutSearchField: UIViewRepresentable {
    @Binding var text: String
    var placeholder: String = "Search..."
    var onFocusChange: (Bool) -> Void = { _ in }
    var onReturn: () -> Void = {}

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    func makeUIView(context: Context) -> UITextField {
        let field = UITextField()
        field.delegate = context.coordinator
        field.returnKeyType = .search
        field.clearButtonMode = .whileEditing
        field.backgroundColor = .clear
        field.inputView = UIView()
        field.inputAssistantItem.leadingBarButtonGroups = []
        field.inputAssistantItem.trailingBarButtonGroups = []
        field.textColor = UIColor(ScoutColors.textPrimary)
        field.tintColor = UIColor(ScoutColors.accent)
        field.font = UIFont.monospacedSystemFont(ofSize: 13, weight: .regular)
        field.attributedPlaceholder = NSAttributedString(
            string: placeholder,
            attributes: [.foregroundColor: UIColor(ScoutColors.textMuted)]
        )
        field.addTarget(context.coordinator,
                        action: #selector(Coordinator.textChanged(_:)),
                        for: .editingChanged)
        return field
    }

    func updateUIView(_ field: UITextField, context: Context) {
        context.coordinator.parent = self
        if field.text != text { field.text = text }
        field.attributedPlaceholder = NSAttributedString(
            string: placeholder,
            attributes: [.foregroundColor: UIColor(ScoutColors.textMuted)]
        )
    }

    class Coordinator: NSObject, UITextFieldDelegate {
        var parent: ScoutSearchField

        init(parent: ScoutSearchField) { self.parent = parent }

        @objc func textChanged(_ field: UITextField) {
            parent.text = field.text ?? ""
        }

        func textFieldDidBeginEditing(_ textField: UITextField) {
            parent.onFocusChange(true)
        }

        func textFieldDidEndEditing(_ textField: UITextField) {
            parent.onFocusChange(false)
        }

        func textFieldShouldReturn(_ textField: UITextField) -> Bool {
            parent.onReturn()
            return false
        }
    }
}
