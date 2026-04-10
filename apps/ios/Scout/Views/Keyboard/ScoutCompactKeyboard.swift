// ScoutCompactKeyboard — UIKit QWERTY keyboard ported from Talkie's CompactKeyboardView.
//
// Full UIKit touch infrastructure: KeyButton with expanded hit slop (±6h/±8v),
// spring press animations, accent long-press popups, hold-to-repeat delete,
// punctuation grid popup, shift/capslock, manual frame layout, nearest-key
// hit targeting, adaptive dark/light colors, haptic feedback.
//
// Three pages: letters, numbers, symbols.
// Row 4 shared: [mode] [emoji] [SPACE] [voice/.] [return]
// Space long-press triggers dictation.
// Period long-press shows punctuation grid.

#if canImport(UIKit)
import UIKit

// MARK: - Accent Mappings

private let accentMappings: [String: [String]] = [
    "a": ["à", "á", "â", "ä", "æ", "ã", "å", "ā"],
    "e": ["è", "é", "ê", "ë", "ē", "ė", "ę"],
    "i": ["ì", "í", "î", "ï", "ī", "į"],
    "o": ["ò", "ó", "ô", "ö", "õ", "ø", "ō", "œ"],
    "u": ["ù", "ú", "û", "ü", "ū"],
    "y": ["ÿ", "ý"],
    "c": ["ç", "ć", "č"],
    "n": ["ñ", "ń"],
    "s": ["ß", "ś", "š"],
    "z": ["ž", "ź", "ż"],
    "l": ["ł"],
    "d": ["ð"],
    "1": ["!", "¡", "¹"], "2": ["@", "²"], "3": ["#", "³"],
    "4": ["$", "¢", "£", "€"], "5": ["%", "‰"], "6": ["^", "¨"],
    "7": ["&"], "8": ["*"], "9": ["("], "0": [")", "°"],
    ".": ["…", ",", "?", "!", "'", "\"", "-", ":", ";"],
    ",": ["‚", "„"], "?": ["¿"], "!": ["¡"],
    "'": ["'", "'", "‚", "‛", "\""],
    "-": ["–", "—", "−"],
]

// MARK: - KeyButton

private class KeyButton: UIButton {
    var keyValue = ""
    var isShiftKey = false
    var isDeleteKey = false
    var isSpaceKey = false
    var isReturnKey = false
    var isSymbolKey = false
    var isModeKey = false
    var isEmojiKey = false

    var hasAccents: Bool { accentMappings[keyValue.lowercased()] != nil }

    // Expanded hit slop for fast repeated taps on narrow keys
    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        bounds.insetBy(dx: -6, dy: -8).contains(point)
    }
}

// MARK: - ScoutCompactKeyboard

final class ScoutCompactKeyboard: UIView {

    // MARK: - Colors (dark-first, Dispatch adapted)

    private enum Colors {
        static let background = UIColor.clear

        static let keyBackground = UIColor { t in
            t.userInterfaceStyle == .dark
                ? UIColor(white: 1.0, alpha: 0.03)
                : UIColor(white: 1.0, alpha: 0.74)
        }
        static let keyPressed = UIColor { t in
            t.userInterfaceStyle == .dark
                ? UIColor(white: 1.0, alpha: 0.12)
                : UIColor(white: 1.0, alpha: 0.92)
        }
        static let specialKey = UIColor { t in
            t.userInterfaceStyle == .dark
                ? UIColor(white: 1.0, alpha: 0.05)
                : UIColor(white: 1.0, alpha: 0.80)
        }
        static let specialKeyActive = UIColor { t in
            t.userInterfaceStyle == .dark
                ? UIColor(white: 1.0, alpha: 0.14)
                : UIColor(white: 1.0, alpha: 0.92)
        }
        static let keyBorder = UIColor { t in
            t.userInterfaceStyle == .dark
                ? UIColor(white: 1.0, alpha: 0.16)
                : UIColor(white: 0.0, alpha: 0.08)
        }
        static let keyBorderPressed = UIColor { t in
            t.userInterfaceStyle == .dark
                ? UIColor(white: 1.0, alpha: 0.24)
                : UIColor(white: 0.0, alpha: 0.16)
        }
        static let keyText = UIColor { t in
            t.userInterfaceStyle == .dark ? .white : .black
        }
        static let keyShadow = UIColor { t in
            t.userInterfaceStyle == .dark ? .black : UIColor(white: 0, alpha: 0.3)
        }
        // Scout accent blue
        static let accentBlue = UIColor(red: 0.45, green: 0.65, blue: 1.0, alpha: 1.0)
        // Dictation red
        static let vermillion = UIColor(red: 0.91, green: 0.30, blue: 0.24, alpha: 1.0)
        static let popupBackground = UIColor { t in
            t.userInterfaceStyle == .dark
                ? UIColor(red: 0.22, green: 0.22, blue: 0.24, alpha: 0.98)
                : UIColor(red: 0.95, green: 0.95, blue: 0.97, alpha: 0.98)
        }
    }

    // MARK: - Callbacks

    var onKeyTapped: ((String) -> Void)?
    var onDeleteTapped: (() -> Void)?
    var onReturnTapped: (() -> Void)?
    var onSpaceTapped: (() -> Void)?
    var onVoiceTapped: (() -> Void)?
    var onEmojiTapped: (() -> Void)?

    // MARK: - Haptics

    private let lightImpact = UIImpactFeedbackGenerator(style: .light)
    private let mediumImpact = UIImpactFeedbackGenerator(style: .medium)

    // MARK: - State

    private var isShifted = false
    private var isCapsLock = false
    private var isShowingNumbers = false
    private var isShowingSymbols = false

    // MARK: - UI

    private var keyButtons: [KeyButton] = []
    private var accentPopup: UIView?
    private var punctuationPopup: UIView?
    private var accentButtons: [UIButton] = []
    private var activeKeyForAccent: KeyButton?
    private var deleteRepeatTimer: Timer?
    private var suppressShiftTapUntil: CFTimeInterval = 0

    private var keyRestingShadowOpacity: Float {
        traitCollection.userInterfaceStyle == .dark ? 0.12 : 0.05
    }

    // Layout constants
    private let keyHeight: CGFloat = 44
    private let keySpacing: CGFloat = 6
    private let rowSpacing: CGFloat = 8
    private let sidePadding: CGFloat = 3
    private let topPadding: CGFloat = 8
    private let bottomPadding: CGFloat = 6

    // Row 4 preferred widths
    private let row4ModeWidth: CGFloat = 40
    private let row4EmojiWidth: CGFloat = 40
    private let row4PeriodWidth: CGFloat = 38
    private let row4ReturnWidth: CGFloat = 64

    // Key rows
    private let letterRow1 = "qwertyuiop".map(String.init)
    private let letterRow2 = "asdfghjkl".map(String.init)
    private let letterRow3 = "zxcvbnm".map(String.init)
    private let numberRow1 = "1234567890".map(String.init)
    private let numberRow2 = ["-", "/", ":", ";", "(", ")", "$", "&", "@", "\""]
    private let numberRow3 = [".", ",", "?", "!", "'"]
    private let symbolRow1 = ["[", "]", "{", "}", "#", "%", "^", "*", "+", "="]
    private let symbolRow2 = ["_", "\\", "|", "~", "<", ">", "€", "£", "¥", "•"]
    private let symbolRow3 = [".", ",", "?", "!", "'"]

    // MARK: - Init

    override init(frame: CGRect) {
        super.init(frame: frame)
        setupUI()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        setupUI()
    }

    private func setupUI() {
        backgroundColor = Colors.background
        lightImpact.prepare()
        mediumImpact.prepare()
        registerForTraitChanges([UITraitUserInterfaceStyle.self]) { (self: ScoutCompactKeyboard, prev: UITraitCollection) in
            self.handleTraitChange(prev)
        }
        buildKeyboard()
    }

    private func handleTraitChange(_ prev: UITraitCollection?) {
        guard traitCollection.hasDifferentColorAppearance(comparedTo: prev) else { return }
        for btn in keyButtons {
            btn.layer.shadowColor = Colors.keyShadow.cgColor
            btn.layer.borderColor = Colors.keyBorder.cgColor
            btn.layer.shadowOpacity = keyRestingShadowOpacity
        }
    }

    // MARK: - Build

    private func buildKeyboard() {
        keyButtons.forEach { $0.removeFromSuperview() }
        keyButtons.removeAll()
        dismissAccentPopup()
        dismissPunctuationPopup()

        if isShowingSymbols { buildSymbolKeyboard() }
        else if isShowingNumbers { buildNumberKeyboard() }
        else { buildLetterKeyboard() }
    }

    private func buildLetterKeyboard() {
        for (i, key) in letterRow1.enumerated() {
            let btn = createKeyButton(key); btn.tag = 100 + i
            keyButtons.append(btn); addSubview(btn)
        }
        for (i, key) in letterRow2.enumerated() {
            let btn = createKeyButton(key); btn.tag = 200 + i
            keyButtons.append(btn); addSubview(btn)
        }
        let shiftBtn = createSpecialButton("⇧", isShift: true); shiftBtn.tag = 300
        keyButtons.append(shiftBtn); addSubview(shiftBtn)
        for (i, key) in letterRow3.enumerated() {
            let btn = createKeyButton(key); btn.tag = 301 + i
            keyButtons.append(btn); addSubview(btn)
        }
        let delBtn = createSpecialButton("⌫", isDelete: true); delBtn.tag = 308
        keyButtons.append(delBtn); addSubview(delBtn)
        buildRow4()
    }

    private func buildNumberKeyboard() {
        for (i, key) in numberRow1.enumerated() {
            let btn = createKeyButton(key); btn.tag = 100 + i
            keyButtons.append(btn); addSubview(btn)
        }
        for (i, key) in numberRow2.enumerated() {
            let btn = createKeyButton(key); btn.tag = 200 + i
            keyButtons.append(btn); addSubview(btn)
        }
        let moreBtn = createSpecialButton("#+=", isSymbol: true); moreBtn.tag = 300
        keyButtons.append(moreBtn); addSubview(moreBtn)
        for (i, key) in numberRow3.enumerated() {
            let btn = createKeyButton(key); btn.tag = 301 + i
            keyButtons.append(btn); addSubview(btn)
        }
        let delBtn = createSpecialButton("⌫", isDelete: true); delBtn.tag = 306
        keyButtons.append(delBtn); addSubview(delBtn)
        buildRow4()
    }

    private func buildSymbolKeyboard() {
        for (i, key) in symbolRow1.enumerated() {
            let btn = createKeyButton(key); btn.tag = 100 + i
            keyButtons.append(btn); addSubview(btn)
        }
        for (i, key) in symbolRow2.enumerated() {
            let btn = createKeyButton(key); btn.tag = 200 + i
            keyButtons.append(btn); addSubview(btn)
        }
        let numBtn = createSpecialButton("123", isSymbol: true); numBtn.tag = 300
        keyButtons.append(numBtn); addSubview(numBtn)
        for (i, key) in symbolRow3.enumerated() {
            let btn = createKeyButton(key); btn.tag = 301 + i
            keyButtons.append(btn); addSubview(btn)
        }
        let delBtn = createSpecialButton("⌫", isDelete: true); delBtn.tag = 306
        keyButtons.append(delBtn); addSubview(delBtn)
        buildRow4()
    }

    private func buildRow4() {
        let modeLabel = (isShowingNumbers || isShowingSymbols) ? "ABC" : "123"
        let modeBtn = createSpecialButton(modeLabel, isMode: true); modeBtn.tag = 410
        keyButtons.append(modeBtn); addSubview(modeBtn)

        let emojiBtn = createSpecialButton("", isEmoji: true); emojiBtn.tag = 411
        keyButtons.append(emojiBtn); addSubview(emojiBtn)

        let spaceBtn = createSpecialButton("space", isSpace: true); spaceBtn.tag = 412
        let spaceLong = UILongPressGestureRecognizer(target: self, action: #selector(spaceLongPressed(_:)))
        spaceLong.minimumPressDuration = 0.4
        spaceBtn.addGestureRecognizer(spaceLong)
        keyButtons.append(spaceBtn); addSubview(spaceBtn)

        let periodBtn = createKeyButton("."); periodBtn.tag = 413
        let periodLong = UILongPressGestureRecognizer(target: self, action: #selector(periodLongPressed(_:)))
        periodLong.minimumPressDuration = 0.3; periodLong.delaysTouchesBegan = false
        periodBtn.addGestureRecognizer(periodLong)
        keyButtons.append(periodBtn); addSubview(periodBtn)

        let returnBtn = createSpecialButton("return", isReturn: true); returnBtn.tag = 414
        keyButtons.append(returnBtn); addSubview(returnBtn)
    }

    // MARK: - Button Creators

    private func createKeyButton(_ key: String) -> KeyButton {
        let btn = KeyButton(type: .system)
        btn.keyValue = key
        btn.setTitle((isShifted || isCapsLock) ? key.uppercased() : key, for: .normal)
        btn.titleLabel?.font = .systemFont(ofSize: 23, weight: .light)
        btn.setTitleColor(Colors.keyText, for: .normal)
        btn.backgroundColor = Colors.keyBackground
        btn.layer.cornerRadius = 6
        btn.layer.borderWidth = 0.45
        btn.layer.borderColor = Colors.keyBorder.cgColor
        btn.layer.shadowColor = Colors.keyShadow.cgColor
        btn.layer.shadowOffset = CGSize(width: 0, height: 0.5)
        btn.layer.shadowRadius = 1.2
        btn.layer.shadowOpacity = keyRestingShadowOpacity
        btn.addTarget(self, action: #selector(keyTapped(_:)), for: .touchUpInside)
        btn.addTarget(self, action: #selector(keyTouchDown(_:)), for: .touchDown)
        btn.addTarget(self, action: #selector(keyTouchUp(_:)), for: [.touchUpInside, .touchUpOutside, .touchCancel])
        if btn.hasAccents {
            let lp = UILongPressGestureRecognizer(target: self, action: #selector(keyLongPressed(_:)))
            lp.minimumPressDuration = 0.3; lp.delaysTouchesBegan = false
            btn.addGestureRecognizer(lp)
        }
        return btn
    }

    private func createSpecialButton(
        _ label: String, isShift: Bool = false, isDelete: Bool = false,
        isSpace: Bool = false, isReturn: Bool = false,
        isSymbol: Bool = false, isMode: Bool = false, isEmoji: Bool = false
    ) -> KeyButton {
        let btn = KeyButton(type: .system)
        btn.isShiftKey = isShift; btn.isDeleteKey = isDelete; btn.isSpaceKey = isSpace
        btn.isReturnKey = isReturn; btn.isSymbolKey = isSymbol; btn.isModeKey = isMode; btn.isEmojiKey = isEmoji

        let config = UIImage.SymbolConfiguration(pointSize: 18, weight: .medium)
        let shiftCfg = UIImage.SymbolConfiguration(pointSize: 16, weight: .medium)

        if isSpace {
            btn.setTitle("", for: .normal)
            btn.backgroundColor = Colors.keyBackground
        } else if isEmoji {
            btn.setImage(UIImage(systemName: "face.smiling", withConfiguration: config), for: .normal)
            btn.tintColor = Colors.keyText; btn.backgroundColor = Colors.specialKey
        } else if isDelete {
            btn.setImage(UIImage(systemName: "delete.left.fill", withConfiguration: config), for: .normal)
            btn.tintColor = Colors.keyText; btn.backgroundColor = Colors.specialKey
        } else if isReturn {
            btn.setImage(UIImage(systemName: "return", withConfiguration: config), for: .normal)
            btn.tintColor = Colors.keyText; btn.backgroundColor = Colors.specialKey
        } else if isShift {
            let icon = isCapsLock ? "capslock.fill" : (self.isShifted ? "shift.fill" : "shift")
            btn.setImage(UIImage(systemName: icon, withConfiguration: shiftCfg), for: .normal)
            btn.tintColor = Colors.keyText
            btn.backgroundColor = (self.isShifted || isCapsLock) ? Colors.specialKeyActive : Colors.specialKey
        } else {
            btn.setTitle(label, for: .normal)
            btn.backgroundColor = Colors.specialKey
        }

        btn.titleLabel?.font = .systemFont(ofSize: (isSymbol || isMode) ? 15 : 16, weight: .medium)
        btn.setTitleColor(Colors.keyText, for: .normal)
        btn.layer.cornerRadius = 6
        btn.layer.borderWidth = 0.45; btn.layer.borderColor = Colors.keyBorder.cgColor
        btn.layer.shadowColor = Colors.keyShadow.cgColor
        btn.layer.shadowOffset = CGSize(width: 0, height: 0.5)
        btn.layer.shadowRadius = 1.2; btn.layer.shadowOpacity = keyRestingShadowOpacity
        btn.addTarget(self, action: #selector(specialKeyTapped(_:)), for: .touchUpInside)
        btn.addTarget(self, action: #selector(keyTouchDown(_:)), for: .touchDown)
        btn.addTarget(self, action: #selector(specialKeyTouchUp(_:)), for: [.touchUpInside, .touchUpOutside, .touchCancel, .touchDragExit])

        if isDelete {
            let lp = UILongPressGestureRecognizer(target: self, action: #selector(deleteLongPressed(_:)))
            lp.minimumPressDuration = 0.3; lp.delaysTouchesBegan = false
            btn.addGestureRecognizer(lp)
        }
        if isShift {
            let lp = UILongPressGestureRecognizer(target: self, action: #selector(shiftLongPressed(_:)))
            lp.minimumPressDuration = 0.45; lp.delaysTouchesBegan = false
            btn.addGestureRecognizer(lp)
        }
        return btn
    }

    // MARK: - Layout

    override func layoutSubviews() {
        super.layoutSubviews()
        let availH = bounds.height
        let totalVSpacing = rowSpacing * 3 + topPadding + bottomPadding
        let dynH = min(keyHeight, (availH - totalVSpacing) / 4)
        let r1Y = topPadding
        let r2Y = r1Y + dynH + rowSpacing
        let r3Y = r2Y + dynH + rowSpacing
        let r4Y = r3Y + dynH + rowSpacing
        let nonLetter = isShowingNumbers || isShowingSymbols
        layoutRow(startTag: 100, count: 10, y: r1Y, fullWidth: true, kH: dynH)
        layoutRow(startTag: 200, count: nonLetter ? 10 : 9, y: r2Y, fullWidth: nonLetter, kH: dynH)
        layoutRow3(y: r3Y, kH: dynH)
        layoutRow4(y: r4Y, kH: dynH)
    }

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let resolved = super.hitTest(point, with: event)
        if let resolved, resolved !== self { return resolved }
        return nearestLetterKey(for: point) ?? resolved
    }

    private func nearestLetterKey(for point: CGPoint) -> UIView? {
        guard !isShowingNumbers, !isShowingSymbols else { return nil }
        var best: KeyButton?; var bestDist = CGFloat.greatestFiniteMagnitude
        for b in keyButtons where !b.keyValue.isEmpty {
            guard (100...109).contains(b.tag) || (200...208).contains(b.tag) || (301...307).contains(b.tag) else { continue }
            guard b.frame.insetBy(dx: -7, dy: -10).contains(point) else { continue }
            let d = hypot(point.x - b.frame.midX, point.y - b.frame.midY)
            if d < bestDist { bestDist = d; best = b }
        }
        return best
    }

    private func layoutRow(startTag: Int, count: Int, y: CGFloat, fullWidth: Bool, kH: CGFloat) {
        let avail = bounds.width - sidePadding * 2
        let totalSp = keySpacing * CGFloat(count - 1)
        let kW = (avail - totalSp) / CGFloat(count)
        let inset: CGFloat = fullWidth ? 0 : kW * 0.5
        let startX = sidePadding + inset
        let adjW = fullWidth ? kW : (avail - totalSp - inset * 2) / CGFloat(count)
        for i in 0..<count {
            if let btn = keyButtons.first(where: { $0.tag == startTag + i }) {
                btn.frame = CGRect(x: startX + CGFloat(i) * (adjW + keySpacing), y: y, width: adjW, height: kH)
            }
        }
    }

    private func layoutRow3(y: CGFloat, kH: CGFloat) {
        let avail = bounds.width - sidePadding * 2
        let nonLetter = isShowingNumbers || isShowingSymbols
        let letterCount = nonLetter ? numberRow3.count : letterRow3.count
        let specW: CGFloat = 42
        let totalSp = keySpacing * CGFloat(letterCount + 1)
        let lW = (avail - specW * 2 - totalSp) / CGFloat(letterCount)
        keyButtons.first { $0.tag == 300 }?.frame = CGRect(x: sidePadding, y: y, width: specW, height: kH)
        var x = sidePadding + specW + keySpacing
        for i in 0..<letterCount {
            keyButtons.first { $0.tag == 301 + i }?.frame = CGRect(x: x, y: y, width: lW, height: kH)
            x += lW + keySpacing
        }
        let delTag = nonLetter ? 306 : 308
        keyButtons.first { $0.tag == delTag }?.frame = CGRect(x: bounds.width - sidePadding - specW, y: y, width: specW, height: kH)
    }

    private func layoutRow4(y: CGFloat, kH: CGFloat) {
        let avail = bounds.width - sidePadding * 2
        let sp = keySpacing
        let surroundAvail = max(avail - 120 - sp * 4, 0) // 120pt for space
        let prefTotal = row4ModeWidth + row4EmojiWidth + row4PeriodWidth + row4ReturnWidth
        let scale = prefTotal > 0 ? surroundAvail / prefTotal : 1
        let mW = row4ModeWidth * scale
        let eW = row4EmojiWidth * scale
        let pW = row4PeriodWidth * scale
        let rW = max(surroundAvail - mW - eW - pW, 0)
        let spaceW = avail - mW - eW - pW - rW - sp * 4
        let mX = sidePadding
        keyButtons.first { $0.tag == 410 }?.frame = CGRect(x: mX, y: y, width: mW, height: kH)
        let eX = mX + mW + sp
        keyButtons.first { $0.tag == 411 }?.frame = CGRect(x: eX, y: y, width: eW, height: kH)
        let sX = eX + eW + sp
        keyButtons.first { $0.tag == 412 }?.frame = CGRect(x: sX, y: y, width: spaceW, height: kH)
        let pX = sX + spaceW + sp
        keyButtons.first { $0.tag == 413 }?.frame = CGRect(x: pX, y: y, width: pW, height: kH)
        let rX = pX + pW + sp
        keyButtons.first { $0.tag == 414 }?.frame = CGRect(x: rX, y: y, width: rW, height: kH)
    }

    // MARK: - Press Animations

    private func pressScale(for btn: UIButton) -> CGFloat {
        let aspect = max(btn.bounds.width, 1) / max(btn.bounds.height, 1)
        if aspect >= 1.8 { return 0.988 }
        if aspect >= 1.3 { return 0.982 }
        return 0.975
    }

    private func pressTransform(for btn: UIButton) -> CGAffineTransform {
        CGAffineTransform(translationX: 0, y: 0.6)
            .concatenating(CGAffineTransform(scaleX: pressScale(for: btn), y: pressScale(for: btn)))
    }

    @objc private func keyTouchDown(_ sender: KeyButton) {
        lightImpact.impactOccurred(intensity: 0.5); lightImpact.prepare()
        UIView.animate(withDuration: 0.05, delay: 0, options: [.allowUserInteraction, .beginFromCurrentState, .curveEaseOut]) {
            sender.transform = self.pressTransform(for: sender)
            sender.backgroundColor = Colors.keyPressed
            sender.layer.borderColor = Colors.keyBorderPressed.cgColor
            sender.layer.shadowOpacity = 0.02
        }
    }

    @objc private func keyTouchUp(_ sender: KeyButton) {
        UIView.animate(withDuration: 0.16, delay: 0, usingSpringWithDamping: 0.76, initialSpringVelocity: 0.45,
                       options: [.allowUserInteraction, .beginFromCurrentState, .curveEaseOut]) {
            sender.transform = .identity
            sender.backgroundColor = Colors.keyBackground
            sender.layer.borderColor = Colors.keyBorder.cgColor
            sender.layer.shadowOpacity = self.keyRestingShadowOpacity
        }
    }

    @objc private func specialKeyTouchUp(_ sender: KeyButton) {
        UIView.animate(withDuration: 0.16, delay: 0, usingSpringWithDamping: 0.76, initialSpringVelocity: 0.45,
                       options: [.allowUserInteraction, .beginFromCurrentState, .curveEaseOut]) {
            sender.transform = .identity
            self.applySpecialResting(sender)
        }
    }

    private func applySpecialResting(_ btn: KeyButton) {
        btn.layer.borderColor = Colors.keyBorder.cgColor
        btn.layer.shadowOpacity = keyRestingShadowOpacity
        if btn.isShiftKey {
            btn.backgroundColor = (isCapsLock || isShifted) ? Colors.specialKeyActive : Colors.specialKey
        } else if btn.isSpaceKey {
            btn.backgroundColor = Colors.keyBackground
        } else {
            btn.backgroundColor = Colors.specialKey
        }
    }

    // MARK: - Key Actions

    @objc private func keyTapped(_ sender: KeyButton) {
        dismissPunctuationPopup()
        let key = (isShifted || isCapsLock) ? sender.keyValue.uppercased() : sender.keyValue
        onKeyTapped?(key)
        if isShifted && !isCapsLock { isShifted = false; updateKeyLabels() }
    }

    @objc private func specialKeyTapped(_ sender: KeyButton) {
        dismissPunctuationPopup()
        if sender.isShiftKey {
            guard CACurrentMediaTime() >= suppressShiftTapUntil else { return }
            if isShifted && !isCapsLock { isCapsLock = true }
            else if isCapsLock { isCapsLock = false; isShifted = false }
            else { isShifted = true }
            updateKeyLabels(); updateShiftButton()
        } else if sender.isDeleteKey { onDeleteTapped?() }
        else if sender.isSpaceKey { onSpaceTapped?() }
        else if sender.isReturnKey { onReturnTapped?() }
        else if sender.isEmojiKey { onEmojiTapped?() }
        else if sender.isModeKey {
            if isShowingNumbers || isShowingSymbols { isShowingNumbers = false; isShowingSymbols = false }
            else { isShowingNumbers = true }
            buildKeyboard(); setNeedsLayout()
        } else if sender.isSymbolKey {
            isShowingSymbols.toggle(); buildKeyboard(); setNeedsLayout()
        }
    }

    // MARK: - Hold-to-Repeat Delete

    @objc private func deleteLongPressed(_ g: UILongPressGestureRecognizer) {
        switch g.state {
        case .began:
            deleteRepeatTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
                Task { @MainActor in self?.onDeleteTapped?() }
            }
        case .ended, .cancelled: deleteRepeatTimer?.invalidate(); deleteRepeatTimer = nil
        default: break
        }
    }

    // MARK: - Shift Long Press (Caps Lock)

    @objc private func shiftLongPressed(_ g: UILongPressGestureRecognizer) {
        guard g.state == .began else { return }
        suppressShiftTapUntil = CACurrentMediaTime() + 0.4
        isCapsLock = true; isShifted = true
        updateKeyLabels(); updateShiftButton()
        mediumImpact.impactOccurred(); mediumImpact.prepare()
    }

    // MARK: - Space Long Press (Voice)

    @objc private func spaceLongPressed(_ g: UILongPressGestureRecognizer) {
        guard g.state == .began else { return }
        mediumImpact.impactOccurred()
        onVoiceTapped?()
    }

    // MARK: - Period Long Press (Punctuation Grid)

    @objc private func periodLongPressed(_ g: UILongPressGestureRecognizer) {
        guard g.state == .began, let btn = g.view as? KeyButton else { return }
        mediumImpact.impactOccurred(); mediumImpact.prepare()
        showPunctuationPopup(for: btn)
    }

    // MARK: - Accent Popup

    @objc private func keyLongPressed(_ g: UILongPressGestureRecognizer) {
        guard let btn = g.view as? KeyButton else { return }
        switch g.state {
        case .began: showAccentPopup(for: btn)
        case .changed: updateAccentSelection(for: g)
        case .ended, .cancelled: selectAccentAndDismiss(for: g)
        default: break
        }
    }

    private func showAccentPopup(for key: KeyButton) {
        dismissPunctuationPopup()
        guard let accents = accentMappings[key.keyValue.lowercased()] else { return }
        activeKeyForAccent = key; accentPopup?.removeFromSuperview(); accentButtons.removeAll()
        let popup = UIView()
        popup.backgroundColor = Colors.popupBackground
        popup.layer.cornerRadius = 8
        popup.layer.shadowColor = Colors.keyShadow.cgColor
        popup.layer.shadowOffset = CGSize(width: 0, height: 4)
        popup.layer.shadowRadius = 12; popup.layer.shadowOpacity = 0.6
        let bW: CGFloat = 36, bH: CGFloat = 42, sp: CGFloat = 2, pad: CGFloat = 6
        let pW = CGFloat(accents.count) * bW + CGFloat(accents.count - 1) * sp + pad * 2
        let pH = bH + pad * 2
        let keyF = key.convert(key.bounds, to: self)
        var pX = keyF.midX - pW / 2; var pY = keyF.minY - pH - 8
        if pY < 0 { pY = keyF.maxY + 8 }
        pX = max(sidePadding, min(bounds.width - pW - sidePadding, pX))
        popup.frame = CGRect(x: pX, y: pY, width: pW, height: pH)
        for (i, accent) in accents.enumerated() {
            let b = UIButton(type: .system); b.setTitle(accent, for: .normal)
            b.titleLabel?.font = .systemFont(ofSize: 22); b.setTitleColor(Colors.keyText, for: .normal)
            b.backgroundColor = .clear; b.tag = i
            b.frame = CGRect(x: pad + CGFloat(i) * (bW + sp), y: pad, width: bW, height: bH)
            popup.addSubview(b); accentButtons.append(b)
        }
        addSubview(popup); accentPopup = popup
        mediumImpact.impactOccurred(); mediumImpact.prepare()
    }

    private func updateAccentSelection(for g: UILongPressGestureRecognizer) {
        guard let popup = accentPopup else { return }
        let loc = g.location(in: popup)
        for b in accentButtons { b.backgroundColor = b.frame.contains(loc) ? Colors.accentBlue : .clear }
    }

    private func selectAccentAndDismiss(for g: UILongPressGestureRecognizer) {
        guard let popup = accentPopup else { dismissAccentPopup(); return }
        let loc = g.location(in: popup)
        if let sel = accentButtons.first(where: { $0.frame.contains(loc) })?.title(for: .normal) {
            let final = (isShifted || isCapsLock) ? sel.uppercased() : sel
            onKeyTapped?(final)
            if isShifted && !isCapsLock { isShifted = false; updateKeyLabels() }
        }
        dismissAccentPopup()
    }

    private func dismissAccentPopup() {
        accentPopup?.removeFromSuperview(); accentPopup = nil
        accentButtons.removeAll(); activeKeyForAccent = nil
    }

    // MARK: - Punctuation Popup

    private func showPunctuationPopup(for key: KeyButton) {
        dismissAccentPopup(); dismissPunctuationPopup()
        let rows: [[String]] = [
            [".", ",", "?", "!", ":", ";", "…"],
            ["'", "\"", "\u{201C}", "\u{201D}", "\u{2018}", "\u{2019}", "—", "–"],
            ["(", ")", "[", "]", "{", "}", "<", ">"],
            ["@", "#", "$", "%", "&", "*", "+", "="],
            ["/", "\\", "|", "_", "~", "`", "^", "•"],
        ]
        let popup = UIView(); popup.backgroundColor = Colors.popupBackground
        popup.layer.cornerRadius = 10; popup.layer.shadowColor = Colors.keyShadow.cgColor
        popup.layer.shadowOffset = CGSize(width: 0, height: 4)
        popup.layer.shadowRadius = 12; popup.layer.shadowOpacity = 0.6
        let bW: CGFloat = 30, bH: CGFloat = 34, hSp: CGFloat = 4, vSp: CGFloat = 4, pad: CGFloat = 8
        let maxCols = rows.map(\.count).max() ?? 0
        let pW = CGFloat(maxCols) * bW + CGFloat(max(maxCols - 1, 0)) * hSp + pad * 2
        let pH = CGFloat(rows.count) * bH + CGFloat(max(rows.count - 1, 0)) * vSp + pad * 2
        let keyF = key.convert(key.bounds, to: self)
        var pX = keyF.midX - pW / 2; var pY = keyF.minY - pH - 8
        if pY < 0 { pY = keyF.maxY + 8 }
        pX = max(sidePadding, min(bounds.width - pW - sidePadding, pX))
        popup.frame = CGRect(x: pX, y: pY, width: pW, height: pH)
        for (ri, row) in rows.enumerated() {
            let rW = CGFloat(row.count) * bW + CGFloat(max(row.count - 1, 0)) * hSp
            var x = (pW - rW) / 2; let y = pad + CGFloat(ri) * (bH + vSp)
            for sym in row {
                let b = UIButton(type: .system)
                b.frame = CGRect(x: x, y: y, width: bW, height: bH)
                b.setTitle(sym, for: .normal); b.titleLabel?.font = .systemFont(ofSize: 19)
                b.setTitleColor(Colors.keyText, for: .normal); b.backgroundColor = Colors.keyBackground
                b.layer.cornerRadius = 6
                b.addAction(UIAction { [weak self] _ in self?.onKeyTapped?(sym); self?.dismissPunctuationPopup() }, for: .touchUpInside)
                popup.addSubview(b); x += bW + hSp
            }
        }
        punctuationPopup = popup; addSubview(popup)
    }

    private func dismissPunctuationPopup() { punctuationPopup?.removeFromSuperview(); punctuationPopup = nil }

    // MARK: - Update Helpers

    private func updateKeyLabels() {
        for b in keyButtons where !b.keyValue.isEmpty {
            b.setTitle((isShifted || isCapsLock) ? b.keyValue.uppercased() : b.keyValue, for: .normal)
        }
    }

    private func updateShiftButton() {
        let cfg = UIImage.SymbolConfiguration(pointSize: 16, weight: .medium)
        for b in keyButtons where b.isShiftKey {
            b.tintColor = Colors.keyText; b.layer.borderColor = Colors.keyBorder.cgColor
            if isCapsLock {
                b.backgroundColor = Colors.specialKeyActive
                b.setImage(UIImage(systemName: "capslock.fill", withConfiguration: cfg), for: .normal)
            } else if isShifted {
                b.backgroundColor = Colors.specialKeyActive
                b.setImage(UIImage(systemName: "shift.fill", withConfiguration: cfg), for: .normal)
            } else {
                b.backgroundColor = Colors.specialKey
                b.setImage(UIImage(systemName: "shift", withConfiguration: cfg), for: .normal)
            }
        }
    }

    // MARK: - Preferred Height

    static let preferredHeight: CGFloat = 224
    static let minimizedHeight: CGFloat = 44

    // MARK: - Public Page Control

    enum Page { case letters, numbers, symbols }

    var currentPage: Page {
        if isShowingSymbols { return .symbols }
        if isShowingNumbers { return .numbers }
        return .letters
    }

    func switchToPage(_ page: Page) {
        isShowingNumbers = (page == .numbers)
        isShowingSymbols = (page == .symbols)
        buildKeyboard()
        setNeedsLayout()
    }

    func nextPage() {
        switch currentPage {
        case .letters: switchToPage(.numbers)
        case .numbers: switchToPage(.symbols)
        case .symbols: switchToPage(.letters)
        }
    }

    func previousPage() {
        switch currentPage {
        case .letters: switchToPage(.symbols)
        case .numbers: switchToPage(.letters)
        case .symbols: switchToPage(.numbers)
        }
    }
}

// MARK: - SwiftUI Bridge

import SwiftUI

/// SwiftUI wrapper for the UIKit-based ScoutCompactKeyboard.
struct ScoutCompactKeyboardView: UIViewRepresentable {
    var onInsert: (String) -> Void
    var onDelete: () -> Void
    var onReturn: () -> Void
    var onVoice: () -> Void

    func makeUIView(context: Context) -> ScoutCompactKeyboard {
        let keyboard = ScoutCompactKeyboard()
        keyboard.onKeyTapped = onInsert
        keyboard.onDeleteTapped = onDelete
        keyboard.onReturnTapped = onReturn
        keyboard.onSpaceTapped = { onInsert(" ") }
        keyboard.onVoiceTapped = onVoice
        return keyboard
    }

    func updateUIView(_ uiView: ScoutCompactKeyboard, context: Context) {
        uiView.onKeyTapped = onInsert
        uiView.onDeleteTapped = onDelete
        uiView.onReturnTapped = onReturn
        uiView.onSpaceTapped = { onInsert(" ") }
        uiView.onVoiceTapped = onVoice
    }
}
#endif
