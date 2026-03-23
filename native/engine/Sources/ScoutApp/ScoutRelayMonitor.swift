import Dispatch
import Foundation
import Darwin

final class ScoutRelayMonitor: @unchecked Sendable {
    private let fileURLs: [URL]
    private let queue = DispatchQueue(label: "com.openscout.relay-monitor", qos: .utility)
    private let onChange: @Sendable () -> Void

    private var watchedFiles: [WatchedFile] = []
    private var restartWorkItem: DispatchWorkItem?

    init(
        fileURLs: [URL],
        onChange: @escaping @Sendable () -> Void
    ) {
        self.fileURLs = fileURLs
        self.onChange = onChange
    }

    @discardableResult
    func start() -> Bool {
        stop()

        var watchedFiles: [WatchedFile] = []
        watchedFiles.reserveCapacity(fileURLs.count)

        for fileURL in fileURLs {
            guard let watchedFile = makeWatchedFile(for: fileURL) else {
                watchedFiles.forEach { close($0.fileDescriptor) }
                self.watchedFiles = []
                return false
            }

            watchedFiles.append(watchedFile)
        }

        guard !watchedFiles.isEmpty else {
            return false
        }

        self.watchedFiles = watchedFiles
        watchedFiles.forEach { $0.source.resume() }
        return true
    }

    func stop() {
        restartWorkItem?.cancel()
        restartWorkItem = nil
        watchedFiles.forEach { $0.source.cancel() }
        watchedFiles = []
    }

    deinit {
        stop()
    }

    private func makeWatchedFile(for fileURL: URL) -> WatchedFile? {
        let path = fileURL.path(percentEncoded: false)
        let descriptor = open(path, O_EVTONLY)
        guard descriptor >= 0 else {
            return nil
        }

        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: descriptor,
            eventMask: [.write, .extend, .attrib, .link, .rename, .delete, .revoke],
            queue: queue
        )

        source.setEventHandler { [weak self] in
            self?.handleEvent(for: fileURL, events: source.data)
        }

        source.setCancelHandler {
            close(descriptor)
        }

        return WatchedFile(fileDescriptor: descriptor, source: source)
    }

    private func handleEvent(for fileURL: URL, events: DispatchSource.FileSystemEvent) {
        onChange()

        if events.contains(.delete) || events.contains(.rename) || events.contains(.revoke) {
            scheduleRestart(after: 0.15)
            return
        }

        if events.contains(.link) || events.contains(.attrib) {
            let path = fileURL.path(percentEncoded: false)
            if !FileManager.default.fileExists(atPath: path) {
                scheduleRestart(after: 0.15)
            }
        }
    }

    private func scheduleRestart(after delay: TimeInterval) {
        restartWorkItem?.cancel()

        let workItem = DispatchWorkItem { [weak self] in
            _ = self?.start()
        }

        restartWorkItem = workItem
        queue.asyncAfter(deadline: .now() + delay, execute: workItem)
    }
}

private struct WatchedFile {
    let fileDescriptor: CInt
    let source: DispatchSourceFileSystemObject
}
