// CrashCatcher — Persist crash info to disk so it survives process death.
//
// Catches NSExceptions + POSIX signals. Writes to UserDefaults so the
// next launch can display what happened.

import Foundation
import os.log

private let crashKey = "scout_last_crash"

private func crashSignalHandler(_ sig: Int32) {
    let name: String = switch sig {
    case SIGABRT: "SIGABRT"
    case SIGSEGV: "SIGSEGV"
    case SIGBUS:  "SIGBUS"
    case SIGTRAP: "SIGTRAP"
    case SIGILL:  "SIGILL"
    default:      "SIG\(sig)"
    }
    let info = "Signal \(name)\n\n\(Thread.callStackSymbols.joined(separator: "\n"))"
    UserDefaults.standard.set(info, forKey: crashKey)
    UserDefaults.standard.synchronize()
    signal(sig, SIG_DFL)
    raise(sig)
}

enum CrashCatcher {
    static func install() {
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
        guard let crash = UserDefaults.standard.string(forKey: crashKey) else { return nil }
        UserDefaults.standard.removeObject(forKey: crashKey)
        return crash
    }
}
