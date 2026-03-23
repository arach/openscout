import Dispatch
import Foundation
import Darwin

final class ScoutRelayMonitor: @unchecked Sendable {
    private let directoryURL: URL
    private let queue = DispatchQueue(label: "com.openscout.relay-monitor", qos: .utility)
    private let onChange: @Sendable () -> Void

    private var fileDescriptor: CInt = -1
    private var source: DispatchSourceFileSystemObject?

    init(
        directoryURL: URL,
        onChange: @escaping @Sendable () -> Void
    ) {
        self.directoryURL = directoryURL
        self.onChange = onChange
    }

    @discardableResult
    func start() -> Bool {
        stop()

        let path = directoryURL.path(percentEncoded: false)
        let descriptor = open(path, O_EVTONLY)
        guard descriptor >= 0 else {
            return false
        }

        fileDescriptor = descriptor

        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: descriptor,
            eventMask: [.write, .extend, .attrib, .link, .rename, .delete, .revoke],
            queue: queue
        )

        source.setEventHandler { [weak self] in
            guard let self else {
                return
            }

            self.onChange()

            guard let source = self.source else {
                return
            }

            let events = source.data
            if events.contains(.delete) || events.contains(.rename) || events.contains(.revoke) {
                self.queue.asyncAfter(deadline: .now() + 0.15) { [weak self] in
                    _ = self?.start()
                }
            }
        }

        source.setCancelHandler { [weak self] in
            guard let self else {
                return
            }

            if self.fileDescriptor >= 0 {
                close(self.fileDescriptor)
                self.fileDescriptor = -1
            }
        }

        self.source = source
        source.resume()
        return true
    }

    func stop() {
        source?.cancel()
        source = nil

        if fileDescriptor >= 0 {
            close(fileDescriptor)
            fileDescriptor = -1
        }
    }

    deinit {
        stop()
    }
}
