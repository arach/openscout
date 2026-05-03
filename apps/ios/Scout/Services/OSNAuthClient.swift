import AuthenticationServices
import Foundation
import UIKit

struct OpenScoutNetworkSignInResult: Equatable, Sendable {
    let account: OpenScoutNetworkAccount?
    let meshes: [OpenScoutNetworkMesh]
}

@MainActor
final class OSNAuthClient: NSObject, ASWebAuthenticationPresentationContextProviding {
    private var webAuthenticationSession: ASWebAuthenticationSession?
    private let urlSession: URLSession
    private let userDefaults: UserDefaults

    init(urlSession: URLSession = .shared, userDefaults: UserDefaults = .standard) {
        self.urlSession = urlSession
        self.userDefaults = userDefaults
    }

    func signIn(baseURL: URL = MeshRendezvousConfiguration.defaultBaseURL) async throws -> OpenScoutNetworkSignInResult {
        ScoutLog.network.info("Starting OSN GitHub sign-in")
        let callbackURL = try await authenticate(baseURL: baseURL)
        ScoutLog.network.info("OSN GitHub callback received")
        let sessionToken = try Self.sessionToken(from: callbackURL)
        try ScoutIdentity.saveOSNSessionToken(sessionToken)
        ScoutLog.network.info("OSN session token saved")

        let client = MeshRendezvousClient(
            configuration: MeshRendezvousConfiguration(
                isEnabled: true,
                baseURL: baseURL,
                meshId: userDefaults.string(forKey: "scout.osn.meshId")?.trimmedNonEmpty ?? MeshRendezvousConfiguration.defaultMeshId,
                bearerToken: sessionToken
            ),
            session: urlSession
        )
        let account = try await client.fetchSession()
        guard let account else {
            ScoutLog.network.error("OSN session validation failed")
            throw OSNAuthError.invalidSession
        }
        ScoutLog.network.info("OSN session validated for \(account.login)")
        let meshes = try await client.fetchMeshes()
        guard !meshes.isEmpty else {
            ScoutLog.network.warning("OSN sign-in has no mesh access for \(account.login)")
            throw OSNAuthError.noMeshAccess(account.login)
        }
        ScoutLog.network.info("OSN mesh access loaded: \(meshes.map(\.id).joined(separator: ","))")
        persist(account: account, meshes: meshes, baseURL: baseURL)
        return OpenScoutNetworkSignInResult(account: account, meshes: meshes)
    }

    func signOut() throws {
        try ScoutIdentity.deleteOSNSessionToken()
        userDefaults.removeObject(forKey: "scout.osn.email")
        userDefaults.removeObject(forKey: "scout.osn.githubLogin")
    }

    nonisolated static func sessionToken(from callbackURL: URL) throws -> String {
        guard callbackURL.scheme == "openscout",
              callbackURL.host == "osn-auth",
              let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
              let token = components.queryItems?.first(where: { $0.name == "session" })?.value?.trimmedNonEmpty else {
            throw OSNAuthError.invalidCallback
        }
        return token
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes
                .compactMap { $0 as? UIWindowScene }
                .flatMap(\.windows)
                .first { $0.isKeyWindow } ?? ASPresentationAnchor()
        }
    }

    private func authenticate(baseURL: URL) async throws -> URL {
        let authURL = try Self.authStartURL(baseURL: baseURL)
        ScoutLog.network.info("Opening OSN auth URL", detail: authURL.absoluteString)
        return try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: authURL,
                callbackURLScheme: "openscout"
            ) { [weak self] callbackURL, error in
                Task { @MainActor in
                    self?.webAuthenticationSession = nil
                }
                if let error {
                    ScoutLog.network.error("OSN web authentication failed: \(error.localizedDescription)")
                    continuation.resume(throwing: error)
                    return
                }
                guard let callbackURL else {
                    ScoutLog.network.error("OSN web authentication returned no callback URL")
                    continuation.resume(throwing: OSNAuthError.invalidCallback)
                    return
                }
                ScoutLog.network.info("OSN web authentication completed")
                continuation.resume(returning: callbackURL)
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            webAuthenticationSession = session

            if !session.start() {
                webAuthenticationSession = nil
                ScoutLog.network.error("OSN web authentication session could not start")
                continuation.resume(throwing: OSNAuthError.unableToStart)
            }
        }
    }

    private static func authStartURL(baseURL: URL) throws -> URL {
        var components = URLComponents(
            url: baseURL.appending(path: "/v1/auth/github/start"),
            resolvingAgainstBaseURL: false
        )
        components?.queryItems = [
            URLQueryItem(name: "return_to", value: "/v1/auth/native/complete")
        ]
        guard let url = components?.url else {
            throw OSNAuthError.invalidURL
        }
        return url
    }

    private func persist(account: OpenScoutNetworkAccount?, meshes: [OpenScoutNetworkMesh], baseURL: URL) {
        userDefaults.set(true, forKey: "scout.osn.enabled")
        userDefaults.set(baseURL.absoluteString, forKey: "scout.osn.baseURL")
        if let account {
            userDefaults.set(account.email, forKey: "scout.osn.email")
            userDefaults.set(account.login, forKey: "scout.osn.githubLogin")
        }
        if let mesh = meshes.first {
            userDefaults.set(mesh.id, forKey: "scout.osn.meshId")
        }
    }
}

enum OSNAuthError: LocalizedError, Equatable {
    case invalidURL
    case invalidCallback
    case invalidSession
    case noMeshAccess(String)
    case unableToStart

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            "OSN sign-in URL is invalid."
        case .invalidCallback:
            "OSN sign-in returned an invalid callback."
        case .invalidSession:
            "GitHub sign-in completed, but OSN could not validate the new session."
        case .noMeshAccess(let login):
            "GitHub sign-in completed for @\(login), but that account does not have access to an OSN mesh yet."
        case .unableToStart:
            "OSN sign-in could not start."
        }
    }
}
