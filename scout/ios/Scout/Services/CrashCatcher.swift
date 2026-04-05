// CrashCatcher — Persist crash info to disk so it survives process death.
//
// Catches NSExceptions + POSIX signals. Writes to UserDefaults so the
// next launch can display what happened.

import Darwin
import Foundation

private let crashKey = "scout_last_crash"
private let crashSignalFilePath = URL(fileURLWithPath: NSTemporaryDirectory())
    .appendingPathComponent("scout_last_signal.txt")
    .path

nonisolated(unsafe) private var crashSignalFileDescriptor: Int32 = -1

nonisolated(unsafe) private let crashSignalABRT = strdup("Signal SIGABRT\nA fatal signal occurred before Scout could capture a safe stack trace.\n")
nonisolated(unsafe) private let crashSignalSEGV = strdup("Signal SIGSEGV\nA fatal signal occurred before Scout could capture a safe stack trace.\n")
nonisolated(unsafe) private let crashSignalBUS = strdup("Signal SIGBUS\nA fatal signal occurred before Scout could capture a safe stack trace.\n")
nonisolated(unsafe) private let crashSignalTRAP = strdup("Signal SIGTRAP\nA fatal signal occurred before Scout could capture a safe stack trace.\n")
nonisolated(unsafe) private let crashSignalILL = strdup("Signal SIGILL\nA fatal signal occurred before Scout could capture a safe stack trace.\n")
nonisolated(unsafe) private let crashSignalUnknown = strdup("Signal SIGUNKNOWN\nA fatal signal occurred before Scout could capture a safe stack trace.\n")

private func crashSignalMessage(_ sig: Int32) -> UnsafeMutablePointer<CChar>? {
    switch sig {
    case SIGABRT: return crashSignalABRT
    case SIGSEGV: return crashSignalSEGV
    case SIGBUS:  return crashSignalBUS
    case SIGTRAP: return crashSignalTRAP
    case SIGILL:  return crashSignalILL
    default:      return crashSignalUnknown
    }
}

private func crashSignalHandler(_ sig: Int32) {
    if crashSignalFileDescriptor >= 0, let message = crashSignalMessage(sig) {
        _ = Darwin.ftruncate(crashSignalFileDescriptor, 0)
        _ = Darwin.lseek(crashSignalFileDescriptor, 0, SEEK_SET)
        _ = Darwin.write(crashSignalFileDescriptor, message, strlen(message))
        Darwin.close(crashSignalFileDescriptor)
        crashSignalFileDescriptor = -1
    }

    signal(sig, SIG_DFL)
    raise(sig)
}

enum CrashCatcher {
    static func install() {
        if crashSignalFileDescriptor >= 0 {
            Darwin.close(crashSignalFileDescriptor)
            crashSignalFileDescriptor = -1
        }

        FileManager.default.removeItemIfExists(atPath: crashSignalFilePath)
        crashSignalFileDescriptor = Darwin.open(crashSignalFilePath, O_WRONLY | O_CREAT | O_TRUNC, S_IRUSR | S_IWUSR)

        NSSetUncaughtExceptionHandler { exception in
            let info = "\(exception.name.rawValue): \(exception.reason ?? "unknown")\n\n\(exception.callStackSymbols.joined(separator: "\n"))"
            UserDefaults.standard.set(info, forKey: crashKey)
            UserDefaults.standard.synchronize()
        }
        for sig: Int32 in [SIGABRT, SIGSEGV, SIGBUS, SIGTRAP, SIGILL] {
            signal(sig, crashSignalHandler)
        }
    }

    static func consumeLastCrash() -> String? {
        if let signalCrash = try? String(contentsOfFile: crashSignalFilePath, encoding: .utf8),
           !signalCrash.isEmpty {
            FileManager.default.removeItemIfExists(atPath: crashSignalFilePath)
            return signalCrash
        }

        guard let crash = UserDefaults.standard.string(forKey: crashKey) else { return nil }
        UserDefaults.standard.removeObject(forKey: crashKey)
        return crash
    }
}

private extension FileManager {
    func removeItemIfExists(atPath path: String) {
        guard fileExists(atPath: path) else { return }
        try? removeItem(atPath: path)
    }
}
