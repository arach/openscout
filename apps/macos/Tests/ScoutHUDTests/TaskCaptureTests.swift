import AppKit
import Foundation
import ScoutAppCore
import ScoutCapabilities
import Testing
@testable import ScoutHUD

@Test func captureCornerAliasesParse() {
    #expect(HUDCaptureCorner(argument: "top_left") == .topLeft)
    #expect(HUDCaptureCorner(argument: "BR") == .bottomRight)
    #expect(HUDCaptureCorner(argument: "middle") == nil)
    #expect(HUDCaptureAnchor(argument: "bottom-left@42") == HUDCaptureAnchor(corner: .bottomLeft, displayID: 42))
    #expect(HUDCaptureAnchor(argument: "top-right") == HUDCaptureAnchor(corner: .topRight))
}

@Test func captureCornerGeometrySupportsNegativeDisplayOrigins() {
    let visible = NSRect(x: -1728, y: -120, width: 1728, height: 1080)
    let zone = HUDCaptureCorner.bottomLeft.hotZone(in: visible, edgeLength: 28)
    #expect(zone == NSRect(x: -1728, y: -120, width: 28, height: 28))

    let panelOrigin = HUDCaptureCorner.topRight.panelOrigin(
        size: NSSize(width: 560, height: 520),
        in: visible
    )
    #expect(panelOrigin == NSPoint(x: -560, y: 440))
}

@MainActor
@Test func localReferencesAreDeduplicatedInSubmissionInstructions() {
    let instructions = HUDRunnerState.instructionsForSubmission(
        "  Review this.  ",
        references: [
            URL(fileURLWithPath: "/repo/Sources/App.swift"),
            URL(fileURLWithPath: "/repo/Sources/App.swift"),
            URL(fileURLWithPath: "/repo/Fixtures"),
        ]
    )
    #expect(instructions == """
    Review this.

    Local references available to this task:
    - `/repo/Sources/App.swift`
    - `/repo/Fixtures`
    """)
}

@Suite(.serialized)
struct HUDRunnerCaptureRegressionTests {
    @MainActor
    @Test func reopeningTaskCaptureMergesIntoTheExistingDraft() throws {
        _ = NSApplication.shared
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("hud-runner-merge-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let runner = HUDRunnerState.shared
        runner.options = try runnerOptions(defaultDirectory: root, projects: [
            (id: "default", title: "Default", root: root, harness: "claude"),
        ])
        runner.open(closesHUDOnDismiss: false, freshDraft: true)
        defer { _ = runner.dismiss() }

        runner.instructions = "First capture"
        runner.open(closesHUDOnDismiss: false, freshDraft: false)
        #expect(runner.stageCapture(ScoutCapturePayload(text: "Second capture")))

        #expect(runner.instructions == "First capture\n\nSecond capture")
    }

    @MainActor
    @Test func droppedProjectOverridesTheAutomaticDefaultProject() throws {
        _ = NSApplication.shared
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("hud-runner-project-tests-\(UUID().uuidString)", isDirectory: true)
        let defaultRoot = root.appendingPathComponent("project-a", isDirectory: true)
        let droppedRoot = root.appendingPathComponent("project-b", isDirectory: true)
        try FileManager.default.createDirectory(at: defaultRoot, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: droppedRoot, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let runner = HUDRunnerState.shared
        runner.options = try runnerOptions(defaultDirectory: defaultRoot, projects: [
            (id: "project-a", title: "Project A", root: defaultRoot, harness: "claude"),
            (id: "project-b", title: "Project B", root: droppedRoot, harness: "codex"),
        ])
        runner.open(closesHUDOnDismiss: false, freshDraft: true)
        defer { _ = runner.dismiss() }
        #expect(runner.selectedProjectId == "project-a")

        #expect(runner.stageFileURLs([droppedRoot]))

        #expect(runner.selectedProjectId == "project-b")
        #expect(runner.directory == droppedRoot.path)
        #expect(runner.selectedHarness == "codex")
        #expect(runner.agentName == "project-b")
        #expect(runner.displayName == "Project B")
    }

    @MainActor
    @Test func taskCaptureDefersWhileRunnerSubmissionIsInFlight() {
        let runner = HUDRunnerState.shared
        runner.isSubmitting = false
        #expect(!ScoutHUDRouter.shouldDeferTaskCapture)

        runner.isSubmitting = true
        #expect(ScoutHUDRouter.shouldDeferTaskCapture)

        runner.isSubmitting = false
        #expect(!ScoutHUDRouter.shouldDeferTaskCapture)
    }

    @MainActor
    @Test func dismissalIsRefusedOnceTaskCreationCommits() async throws {
        _ = NSApplication.shared
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("hud-runner-commit-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let environmentKey = "OPENSCOUT_WEB_URL"
        let previousWebURL = ProcessInfo.processInfo.environment[environmentKey]
        setenv(environmentKey, "https://hud-runner-test.invalid", 1)
        defer {
            if let previousWebURL {
                setenv(environmentKey, previousWebURL, 1)
            } else {
                unsetenv(environmentKey)
            }
        }

        #expect(URLProtocol.registerClass(DelayedSessionURLProtocol.self))
        defer { URLProtocol.unregisterClass(DelayedSessionURLProtocol.self) }

        let runner = HUDRunnerState.shared
        runner.options = try runnerOptions(defaultDirectory: root, projects: [
            (id: "default", title: "Default", root: root, harness: "claude"),
        ])
        runner.open(closesHUDOnDismiss: false, freshDraft: true)
        runner.instructions = "Create a regression task"
        runner.beginSubmit()

        #expect(await waitUntil { runner.isCommittingTask })
        #expect(!runner.dismiss())
        #expect(runner.isPresented)
        #expect(runner.lastError == "Scout is confirming task creation; wait for the result.")

        #expect(await waitUntil { !runner.isSubmitting })
        #expect(runner.dismiss())
    }

    @MainActor
    @Test func taskSubmissionForwardsHarnessModelAndReasoningEffort() async throws {
        _ = NSApplication.shared
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("hud-runner-runtime-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let environmentKey = "OPENSCOUT_WEB_URL"
        let previousWebURL = ProcessInfo.processInfo.environment[environmentKey]
        setenv(environmentKey, "https://hud-runner-recording.invalid", 1)
        defer {
            if let previousWebURL {
                setenv(environmentKey, previousWebURL, 1)
            } else {
                unsetenv(environmentKey)
            }
        }

        RecordingSessionURLProtocol.recorder.reset()
        #expect(URLProtocol.registerClass(RecordingSessionURLProtocol.self))
        defer { URLProtocol.unregisterClass(RecordingSessionURLProtocol.self) }

        let runner = HUDRunnerState.shared
        runner.options = try runnerOptions(defaultDirectory: root, projects: [
            (id: "default", title: "Default", root: root, harness: "codex"),
        ])
        runner.open(closesHUDOnDismiss: false, freshDraft: true)
        runner.selectHarness("codex")
        runner.selectedModel = "gpt-5.6-sol"
        runner.reasoningEffort = "high"
        runner.instructions = "Create a runtime-control regression task"
        runner.beginSubmit()

        #expect(await waitUntil { !runner.isSubmitting })
        let data = try #require(RecordingSessionURLProtocol.recorder.body())
        let spec = try JSONDecoder().decode(SessionInitiationSpec.self, from: data)
        #expect(spec.execution?.harness == "codex")
        #expect(spec.execution?.model == "gpt-5.6-sol")
        #expect(spec.execution?.reasoningEffort == "high")
    }
}

private typealias RunnerProjectFixture = (
    id: String,
    title: String,
    root: URL,
    harness: String
)

private func runnerOptions(
    defaultDirectory: URL,
    projects: [RunnerProjectFixture]
) throws -> HudRunnerOptions {
    let object: [String: Any] = [
        "defaults": [
            "runner": "scout",
            "directory": defaultDirectory.path,
            "harness": "claude",
            "model": "",
            "persistence": "sticky",
        ],
        "runners": [],
        "harnesses": [],
        "models": [],
        "projects": projects.map { project in
            [
                "id": project.id,
                "title": project.title,
                "root": project.root.path,
                "source": "test",
                "registrationKind": "test",
                "defaultHarness": project.harness,
            ]
        },
        "agents": [],
    ]
    let data = try JSONSerialization.data(withJSONObject: object)
    return try JSONDecoder().decode(HudRunnerOptions.self, from: data)
}

@MainActor
private func waitUntil(_ condition: @MainActor () -> Bool) async -> Bool {
    for _ in 0..<200 {
        if condition() { return true }
        try? await Task.sleep(for: .milliseconds(10))
    }
    return condition()
}

private final class DelayedSessionURLProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "hud-runner-test.invalid"
            && request.url?.path == "/api/sessions"
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let url = request.url,
              let response = HTTPURLResponse(
                url: url,
                statusCode: 503,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
              ) else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }

        DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(600)) { [self] in
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data(#"{"error":"test response"}"#.utf8))
            client?.urlProtocolDidFinishLoading(self)
        }
    }

    override func stopLoading() {}
}

private final class LockedRequestBody: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Data?

    func store(_ data: Data?) {
        lock.withLock { value = data }
    }

    func body() -> Data? {
        lock.withLock { value }
    }

    func reset() {
        lock.withLock { value = nil }
    }
}

private final class RecordingSessionURLProtocol: URLProtocol, @unchecked Sendable {
    static let recorder = LockedRequestBody()

    override class func canInit(with request: URLRequest) -> Bool {
        request.url?.host == "hud-runner-recording.invalid"
            && request.url?.path == "/api/sessions"
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        Self.recorder.store(requestBodyData())
        guard let url = request.url,
              let response = HTTPURLResponse(
                url: url,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
              ) else {
            client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
            return
        }
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(#"{"ok":true,"agentId":"agent-test"}"#.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private func requestBodyData() -> Data? {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }

        var body = Data()
        var buffer = [UInt8](repeating: 0, count: 4_096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count < 0 { return nil }
            if count == 0 { break }
            body.append(buffer, count: count)
        }
        return body.isEmpty ? nil : body
    }
}
