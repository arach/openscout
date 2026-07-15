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

@Test func recentHistoryMaintainsMRUOrderCapacityAndPrunesInvalidEntries() {
    var history = HUDRunnerRecentHistory()
    for id in ["project-a", "project-b", "project-c", "project-d"] {
        history.recordProject(id)
    }
    #expect(history.projectIDs == ["project-d", "project-c", "project-b"])

    history.recordProject("  project-c  ")
    history.recordProject("   ")
    #expect(history.projectIDs == ["project-c", "project-d", "project-b"])

    let claudeOpus = HUDRunnerRuntimePreset(
        harness: "claude",
        model: "claude-opus-4-8",
        effort: "medium"
    )
    let codexSol = HUDRunnerRuntimePreset(
        harness: "codex",
        model: "gpt-5.6-sol",
        effort: "high"
    )
    let pi = HUDRunnerRuntimePreset(harness: "pi", model: "pi", effort: "high")
    let claudeSonnet = HUDRunnerRuntimePreset(
        harness: "claude",
        model: "claude-sonnet-4-6",
        effort: "low"
    )
    for preset in [claudeOpus, codexSol, pi, claudeSonnet] {
        history.recordRuntime(preset)
    }
    #expect(history.runtimePresets == [claudeSonnet, pi, codexSol])

    history.recordRuntime(pi)
    history.recordRuntime(HUDRunnerRuntimePreset(harness: " ", model: "ignored", effort: "low"))
    #expect(history.runtimePresets == [pi, claudeSonnet, codexSol])

    history.prune(
        validProjectIDs: Set(["project-c", "project-b"]),
        isRuntimeValid: { $0.harness != "pi" }
    )
    #expect(history.projectIDs == ["project-c", "project-b"])
    #expect(history.runtimePresets == [claudeSonnet, codexSol])
}

@Test func focusOrderContainsOnlyControlsVisibleInEachDisclosure() throws {
    let attachmentID = try #require(UUID(uuidString: "11111111-1111-1111-1111-111111111111"))
    let common: [HUDRunnerFocusTarget] = [
        .instructions,
        .attachment(attachmentID),
        .reference("/repo/README.md"),
        .attach,
        .voice,
        .create,
        .dismiss,
    ]
    func order(_ disclosure: HUDRunnerDisclosure) -> [HUDRunnerFocusTarget] {
        HUDRunnerFocusTarget.visibleOrder(
            disclosure: disclosure,
            projectChoiceIDs: ["project-a", "project-b"],
            runtimeChoiceIDs: ["runtime-a", "runtime-b"],
            attachmentIDs: [attachmentID],
            referenceIDs: ["/repo/README.md"]
        )
    }

    #expect(order(.none) == [.projectSummary, .runtimeSummary] + common)
    #expect(order(.projectChoices) == [
        .disclosureBack,
        .projectChoice("project-a"),
        .projectChoice("project-b"),
        .projectSearch,
    ] + common)
    #expect(order(.projectSearch) == [
        .disclosureBack,
        .projectSearch,
        .browseDirectory,
        .projectChoice("project-a"),
        .projectChoice("project-b"),
    ] + common)
    #expect(order(.runtimeChoices) == [
        .disclosureBack,
        .runtimeChoice("runtime-a"),
        .runtimeChoice("runtime-b"),
        .configureRuntime,
    ] + common)
    #expect(order(.runtimeConfiguration) == [
        .disclosureBack,
        .harness,
        .model,
        .version,
        .effort,
        .route,
        .applyRuntime,
    ] + common)
    #expect(order(.route) == [
        .disclosureBack,
        .persistence,
        .agentName,
        .displayName,
        .disclosureDone,
    ] + common)
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
    @Test func droppedProjectPreservesAnExplicitRuntimeSelection() throws {
        _ = NSApplication.shared
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("hud-runner-runtime-drop-tests-\(UUID().uuidString)", isDirectory: true)
        let defaultRoot = root.appendingPathComponent("project-a", isDirectory: true)
        let droppedRoot = root.appendingPathComponent("project-b", isDirectory: true)
        try FileManager.default.createDirectory(at: defaultRoot, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: droppedRoot, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let runner = HUDRunnerState.shared
        runner.options = try runnerOptions(
            defaultDirectory: defaultRoot,
            projects: [
                (id: "project-a", title: "Project A", root: defaultRoot, harness: "claude"),
                (id: "project-b", title: "Project B", root: droppedRoot, harness: "claude"),
            ],
            includeRuntimeCatalog: true
        )
        runner.open(closesHUDOnDismiss: false, freshDraft: true)
        defer { _ = runner.dismiss() }
        runner.selectRuntimePreset(
            HUDRunnerRuntimePreset(
                harness: "codex",
                model: "gpt-5.6-sol",
                effort: "high"
            )
        )

        #expect(runner.stageFileURLs([droppedRoot]))

        #expect(runner.selectedProjectId == "project-b")
        #expect(runner.currentRuntimePreset == HUDRunnerRuntimePreset(
            harness: "codex",
            model: "gpt-5.6-sol",
            effort: "high"
        ))
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

    @MainActor
    @Test func disclosuresAreMutuallyExclusiveAndEscapeUnwindsOneLevelAtATime() throws {
        _ = NSApplication.shared
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("hud-runner-disclosure-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let runner = HUDRunnerState.shared
        runner.options = try runnerOptions(
            defaultDirectory: root,
            projects: [(id: "default", title: "Default", root: root, harness: "claude")],
            includeRuntimeCatalog: true
        )
        runner.open(closesHUDOnDismiss: false, freshDraft: true)
        defer { _ = runner.dismiss() }

        runner.toggleProjectChoices()
        #expect(runner.disclosure == .projectChoices)
        runner.toggleRuntimeChoices()
        #expect(runner.disclosure == .runtimeChoices)
        #expect(runner.runtimeDraft == nil)

        runner.openProjectSearch()
        #expect(runner.disclosure == .projectSearch)
        #expect(runner.runtimeDraft == nil)
        #expect(runner.escapePressed())
        #expect(runner.disclosure == .projectChoices)
        #expect(runner.escapePressed())
        #expect(runner.disclosure == .none)
        #expect(runner.isPresented)

        runner.openRuntimeConfiguration()
        let draft = try #require(runner.runtimeDraft)
        runner.openRouteConfiguration()
        #expect(runner.disclosure == .route)
        #expect(runner.runtimeDraft == draft)
        #expect(runner.escapePressed())
        #expect(runner.disclosure == .runtimeConfiguration)
        #expect(runner.runtimeDraft == draft)
        #expect(runner.escapePressed())
        #expect(runner.disclosure == .runtimeChoices)
        #expect(runner.runtimeDraft == nil)
        #expect(runner.escapePressed())
        #expect(runner.disclosure == .none)
        #expect(runner.isPresented)
    }

    @MainActor
    @Test func runtimeConfigurationIsTransactionalUntilApplied() throws {
        _ = NSApplication.shared
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("hud-runner-runtime-draft-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let runner = HUDRunnerState.shared
        runner.options = try runnerOptions(
            defaultDirectory: root,
            projects: [(id: "default", title: "Default", root: root, harness: "claude")],
            includeRuntimeCatalog: true
        )
        runner.open(closesHUDOnDismiss: false, freshDraft: true)
        defer { _ = runner.dismiss() }
        runner.selectRuntimePreset(
            HUDRunnerRuntimePreset(
                harness: "claude",
                model: "claude-opus-4-8",
                effort: "medium"
            )
        )
        let committed = runner.currentRuntimePreset

        runner.openRuntimeConfiguration()
        runner.updateRuntimeDraftHarness("codex")
        runner.updateRuntimeDraftModel("gpt-5.6-terra")
        runner.updateRuntimeDraftEffort("high")
        #expect(runner.runtimeDraft == HUDRunnerRuntimePreset(
            harness: "codex",
            model: "gpt-5.6-terra",
            effort: "high"
        ))
        #expect(runner.currentRuntimePreset == committed)

        runner.stepBackDisclosure()
        #expect(runner.disclosure == .runtimeChoices)
        #expect(runner.runtimeDraft == nil)
        #expect(runner.currentRuntimePreset == committed)

        runner.openRuntimeConfiguration()
        runner.updateRuntimeDraftHarness("codex")
        runner.updateRuntimeDraftModel("gpt-5.6-terra")
        runner.updateRuntimeDraftEffort("high")
        runner.applyRuntimeDraft()
        #expect(runner.disclosure == .none)
        #expect(runner.runtimeDraft == nil)
        #expect(runner.currentRuntimePreset == HUDRunnerRuntimePreset(
            harness: "codex",
            model: "gpt-5.6-terra",
            effort: "high"
        ))
    }

    @MainActor
    @Test func intakeAndInvalidSubmitPreserveTheRuntimeDraft() throws {
        _ = NSApplication.shared
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("hud-runner-draft-intake-tests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let runner = HUDRunnerState.shared
        runner.options = try runnerOptions(
            defaultDirectory: root,
            projects: [(id: "default", title: "Default", root: root, harness: "claude")],
            includeRuntimeCatalog: true
        )
        runner.open(closesHUDOnDismiss: false, freshDraft: true)
        defer { _ = runner.dismiss() }
        runner.selectRuntimePreset(
            HUDRunnerRuntimePreset(
                harness: "claude",
                model: "claude-opus-4-8",
                effort: "medium"
            )
        )
        let committed = runner.currentRuntimePreset

        runner.openRuntimeConfiguration()
        runner.updateRuntimeDraftHarness("codex")
        runner.updateRuntimeDraftModel("gpt-5.6-terra")
        runner.updateRuntimeDraftEffort("high")
        let draft = try #require(runner.runtimeDraft)

        runner.beginSubmit()
        #expect(!runner.isSubmitting)
        #expect(runner.disclosure == .runtimeConfiguration)
        #expect(runner.runtimeDraft == draft)
        #expect(runner.currentRuntimePreset == committed)

        #expect(runner.stageCapture(ScoutCapturePayload(text: "Review this task")))
        #expect(runner.disclosure == .runtimeConfiguration)
        #expect(runner.runtimeDraft == draft)
        #expect(runner.currentRuntimePreset == committed)

        #expect(runner.stageFileURLs([root]))
        #expect(runner.disclosure == .runtimeConfiguration)
        #expect(runner.runtimeDraft == draft)
        #expect(runner.currentRuntimePreset == committed)
    }

    @MainActor
    @Test func projectSearchDoesNotClearTheCommittedProject() throws {
        _ = NSApplication.shared
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("hud-runner-project-search-tests-\(UUID().uuidString)", isDirectory: true)
        let projectA = root.appendingPathComponent("project-a", isDirectory: true)
        let projectB = root.appendingPathComponent("project-b", isDirectory: true)
        try FileManager.default.createDirectory(at: projectA, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: projectB, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let runner = HUDRunnerState.shared
        runner.options = try runnerOptions(defaultDirectory: projectA, projects: [
            (id: "project-a", title: "Project A", root: projectA, harness: "claude"),
            (id: "project-b", title: "Project B", root: projectB, harness: "codex"),
        ])
        runner.open(closesHUDOnDismiss: false, freshDraft: true)
        defer { _ = runner.dismiss() }
        let committed = try #require(runner.options?.projects.first { $0.id == "project-b" })
        runner.chooseProject(committed)

        runner.openProjectSearch()
        runner.updateProjectSearchQuery("Project A")

        #expect(runner.disclosure == .projectSearch)
        #expect(runner.projectSearchQuery == "Project A")
        #expect(runner.projectMatches().map(\.id) == ["project-a"])
        #expect(runner.selectedProjectId == "project-b")
        #expect(runner.projectQuery == "Project B")
        #expect(runner.directory == projectB.path)

        #expect(runner.escapePressed())
        #expect(runner.disclosure == .projectChoices)
        #expect(runner.selectedProjectId == "project-b")
        #expect(runner.directory == projectB.path)
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
    projects: [RunnerProjectFixture],
    includeRuntimeCatalog: Bool = false
) throws -> HudRunnerOptions {
    var defaults: [String: Any] = [
        "runner": "scout",
        "directory": defaultDirectory.path,
        "harness": "claude",
        "model": "",
        "persistence": "sticky",
    ]
    if includeRuntimeCatalog {
        defaults["model"] = "claude-opus-4-8"
        defaults["reasoningEffort"] = "medium"
    }
    let object: [String: Any] = [
        "defaults": defaults,
        "runners": [],
        "harnesses": includeRuntimeCatalog ? [
            ["id": "claude", "name": "claude", "label": "Claude", "ready": true],
            ["id": "codex", "name": "codex", "label": "Codex", "ready": true],
        ] : [],
        "models": includeRuntimeCatalog ? [
            [
                "id": "claude-opus-4-8",
                "label": "Opus 4.8",
                "harnesses": ["claude"],
                "source": "test",
            ],
            [
                "id": "gpt-5.6-sol",
                "label": "GPT-5.6 Sol",
                "harnesses": ["codex"],
                "source": "test",
            ],
            [
                "id": "gpt-5.6-terra",
                "label": "GPT-5.6 Terra",
                "harnesses": ["codex"],
                "source": "test",
            ],
        ] : [],
        "efforts": includeRuntimeCatalog ? [
            ["id": "medium", "label": "Medium", "harnesses": ["claude", "codex"]],
            ["id": "high", "label": "High", "harnesses": ["claude", "codex"]],
        ] : [],
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
