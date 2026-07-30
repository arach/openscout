import AVFoundation
import Foundation
import Speech

/// Native macOS 26+ live dictation powered by SpeechAnalyzer and
/// SpeechTranscriber. Scout owns capture and lifecycle; Apple owns the model,
/// volatile/final result stream, and system-managed assets.
@available(macOS 26.0, *)
@MainActor
final class ScoutSpeechAnalyzerDictation {
    enum DictationError: LocalizedError {
        case unavailable
        case unsupportedLocale(String)
        case unsupportedAssets
        case missingAudioFormat
        case inactiveSession

        var errorDescription: String? {
            switch self {
            case .unavailable:
                return "SpeechAnalyzer is unavailable on this Mac."
            case .unsupportedLocale(let locale):
                return "SpeechAnalyzer does not support the current language (\(locale))."
            case .unsupportedAssets:
                return "SpeechAnalyzer assets are unavailable for the current language."
            case .missingAudioFormat:
                return "SpeechAnalyzer could not negotiate a microphone audio format."
            case .inactiveSession:
                return "The SpeechAnalyzer session is no longer active."
            }
        }
    }

    private let audioEngine = AVAudioEngine()
    private let converter = ScoutSpeechBufferConverter()

    private var transcriber: SpeechTranscriber?
    private var analyzer: SpeechAnalyzer?
    private var analyzerFormat: AVAudioFormat?
    private var inputContinuation: AsyncStream<AnalyzerInput>.Continuation?
    private var audioContinuation: AsyncStream<ScoutAudioBuffer>.Continuation?
    private var pumpTask: Task<Void, Error>?
    private var resultsTask: Task<Void, Error>?
    private var tapInstalled = false
    private var finalizedSegments: [String] = []
    private var volatileText = ""
    private var partialHandler: ((String) -> Void)?

    private(set) var modelReady = false
    private(set) var isRecording = false

    func prepare() async throws {
        guard SpeechTranscriber.isAvailable else {
            throw DictationError.unavailable
        }
        if analyzer != nil, analyzerFormat != nil {
            return
        }

        let requestedLocale = Locale.current
        guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: requestedLocale) else {
            throw DictationError.unsupportedLocale(requestedLocale.identifier)
        }

        let transcriber = SpeechTranscriber(
            locale: locale,
            preset: .progressiveTranscription
        )
        let modules: [any SpeechModule] = [transcriber]
        let status = await AssetInventory.status(forModules: modules)
        guard status != .unsupported else {
            throw DictationError.unsupportedAssets
        }
        if let request = try await AssetInventory.assetInstallationRequest(supporting: modules) {
            try await request.downloadAndInstall()
        }

        guard let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: modules) else {
            throw DictationError.missingAudioFormat
        }
        let analyzer = SpeechAnalyzer(modules: modules)
        try await analyzer.prepareToAnalyze(in: format)

        self.transcriber = transcriber
        self.analyzer = analyzer
        self.analyzerFormat = format
        modelReady = true
    }

    func start(onPartial: @escaping (String) -> Void) async throws {
        guard !isRecording else { return }
        try await prepare()
        guard let transcriber, let analyzer, let analyzerFormat else {
            throw DictationError.inactiveSession
        }

        finalizedSegments = []
        volatileText = ""
        partialHandler = onPartial

        let (inputStream, inputContinuation) = AsyncStream<AnalyzerInput>.makeStream()
        self.inputContinuation = inputContinuation
        resultsTask = Task { [weak self, transcriber] in
            for try await result in transcriber.results {
                guard let self, !Task.isCancelled else { return }
                let text = String(result.text.characters)
                self.receive(text: text, isFinal: result.isFinal)
            }
        }
        try await analyzer.start(inputSequence: inputStream)

        let (audioStream, audioContinuation) = AsyncStream<ScoutAudioBuffer>.makeStream()
        self.audioContinuation = audioContinuation
        let converter = self.converter
        pumpTask = Task {
            defer { inputContinuation.finish() }
            for await audio in audioStream {
                try Task.checkCancellation()
                let converted = try converter.convert(audio.buffer, to: analyzerFormat)
                inputContinuation.yield(AnalyzerInput(buffer: converted))
            }
        }

        let input = audioEngine.inputNode
        let captureFormat = input.outputFormat(forBus: 0)
        input.installTap(onBus: 0, bufferSize: 4096, format: captureFormat) { buffer, _ in
            audioContinuation.yield(ScoutAudioBuffer(buffer))
        }
        tapInstalled = true
        audioEngine.prepare()
        do {
            try audioEngine.start()
            isRecording = true
        } catch {
            await cancel()
            throw error
        }
    }

    func stop() async throws -> String {
        guard isRecording, let analyzer else {
            throw DictationError.inactiveSession
        }
        stopCapture()
        audioContinuation?.finish()
        audioContinuation = nil
        try await pumpTask?.value
        pumpTask = nil
        try await analyzer.finalizeAndFinishThroughEndOfInput()
        // Finalization drains the analyzer through end-of-input. Match Apple's
        // sample lifecycle by cancelling the open-ended results iterator only
        // after that drain completes; waiting for the sequence itself to close
        // can otherwise strand the UI in Processing.
        resultsTask?.cancel()
        _ = try? await resultsTask?.value
        resultsTask = nil

        let final = joined(finalizedSegments)
        resetSession(keepModelReady: true)
        return final
    }

    func cancel() async {
        stopCapture()
        audioContinuation?.finish()
        inputContinuation?.finish()
        audioContinuation = nil
        inputContinuation = nil
        pumpTask?.cancel()
        resultsTask?.cancel()
        pumpTask = nil
        resultsTask = nil
        if let analyzer {
            await analyzer.cancelAndFinishNow()
        }
        resetSession(keepModelReady: modelReady)
    }

    private func receive(text: String, isFinal: Bool) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        if isFinal {
            finalizedSegments.append(trimmed)
            volatileText = ""
        } else {
            volatileText = trimmed
        }
        partialHandler?(joined(finalizedSegments + (volatileText.isEmpty ? [] : [volatileText])))
    }

    private func joined(_ segments: [String]) -> String {
        segments
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    private func stopCapture() {
        if tapInstalled {
            audioEngine.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }
        if audioEngine.isRunning {
            audioEngine.stop()
        }
        isRecording = false
    }

    private func resetSession(keepModelReady: Bool) {
        transcriber = nil
        analyzer = nil
        analyzerFormat = nil
        inputContinuation = nil
        audioContinuation = nil
        partialHandler = nil
        finalizedSegments = []
        volatileText = ""
        modelReady = keepModelReady
    }
}

@available(macOS 26.0, *)
@MainActor
private final class ScoutSpeechBufferConverter {
    enum ConversionError: LocalizedError {
        case unavailable
        case bufferAllocation
        case failed(NSError?)

        var errorDescription: String? {
            switch self {
            case .unavailable: return "The microphone audio converter is unavailable."
            case .bufferAllocation: return "The microphone conversion buffer could not be allocated."
            case .failed(let error): return error?.localizedDescription ?? "Microphone audio conversion failed."
            }
        }
    }

    private var converter: AVAudioConverter?

    func convert(_ buffer: AVAudioPCMBuffer, to format: AVAudioFormat) throws -> AVAudioPCMBuffer {
        if buffer.format == format {
            return buffer
        }
        if converter?.inputFormat != buffer.format || converter?.outputFormat != format {
            converter = AVAudioConverter(from: buffer.format, to: format)
            converter?.primeMethod = .none
        }
        guard let converter else { throw ConversionError.unavailable }

        let ratio = converter.outputFormat.sampleRate / converter.inputFormat.sampleRate
        let capacity = AVAudioFrameCount((Double(buffer.frameLength) * ratio).rounded(.up))
        guard let converted = AVAudioPCMBuffer(
            pcmFormat: converter.outputFormat,
            frameCapacity: capacity
        ) else {
            throw ConversionError.bufferAllocation
        }

        var conversionError: NSError?
        let input = ScoutOneShotAudioBuffer(buffer)
        let status = converter.convert(to: converted, error: &conversionError) { _, inputStatus in
            input.take(status: inputStatus)
        }
        guard status != .error else {
            throw ConversionError.failed(conversionError)
        }
        return converted
    }
}

/// AVAudioPCMBuffer predates Swift concurrency. Ownership transfers from the
/// audio tap into the analyzer pump through this single-consumer stream.
private struct ScoutAudioBuffer: @unchecked Sendable {
    let buffer: AVAudioPCMBuffer

    init(_ buffer: AVAudioPCMBuffer) {
        self.buffer = buffer
    }
}

/// AVAudioConverter's input callback is declared `@Sendable` even though the
/// conversion call is synchronous. Keeping its one-shot state in an explicitly
/// synchronized reference avoids capturing mutable local state or a
/// non-Sendable AVAudioPCMBuffer directly in that closure.
private final class ScoutOneShotAudioBuffer: @unchecked Sendable {
    private let lock = NSLock()
    private let buffer: AVAudioPCMBuffer
    private var consumed = false

    init(_ buffer: AVAudioPCMBuffer) {
        self.buffer = buffer
    }

    func take(status: UnsafeMutablePointer<AVAudioConverterInputStatus>) -> AVAudioBuffer? {
        lock.lock()
        defer { lock.unlock() }
        guard !consumed else {
            status.pointee = .noDataNow
            return nil
        }
        consumed = true
        status.pointee = .haveData
        return buffer
    }
}
