import Foundation

struct ApexSovereignApp: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let role: String
    let entry: String
}

struct ApexSovereignControlClient: Sendable {
    let baseURL: URL
    let token: String

    func status() async throws -> String {
        let data = try await request(path: "api/mobile/sovereign/status", method: "GET")
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        let count = object["canonicalAppCount"] as? Int ?? 0
        let storage = object["storage"] as? String ?? "unknown"
        let mesh = object["mesh"] as? [String: Any] ?? [:]
        let online = mesh["runtimeOnline"] as? Bool ?? false
        return "Fabric: \(count) apps • storage: \(storage) • runtime: \(online ? "online" : "offline")"
    }

    func apps() async throws -> [ApexSovereignApp] {
        let data = try await request(path: "api/mobile/apps", method: "GET")
        struct Envelope: Decodable {
            let success: Bool
            let apps: [ApexSovereignApp]
        }
        let envelope = try JSONDecoder().decode(Envelope.self, from: data)
        guard envelope.success else { throw ApexSovereignControlError.invalidResponse }
        return envelope.apps
    }

    func dispatch(appID: String, action: String) async throws -> String {
        let body: [String: Any] = [
            "appId": appID,
            "action": action,
            "waveId": UUID().uuidString,
            "data": ["source": "iphone-ui"]
        ]
        let data = try await request(path: "api/mobile/sovereign/dispatch", method: "POST", body: body)
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        let accepted = object["accepted"] as? Bool ?? false
        let queued = object["queued"] as? Bool ?? false
        let waveID = object["waveId"] as? String ?? "unknown"
        return accepted
            ? "Accepted wave \(waveID) • \(queued ? "durably queued; peer delivery pending" : "already processed")"
            : "Server did not confirm acceptance."
    }

    private func request(path: String, method: String, body: [String: Any]? = nil) async throws -> Data {
        var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
        guard components != nil else { throw ApexSovereignControlError.invalidURL }
        components!.path = components!.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/" + path
        guard let url = components!.url, url.scheme == "https" || url.scheme == "http" else {
            throw ApexSovereignControlError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue(token, forHTTPHeaderField: "x-apex-shortcut-token")
        request.timeoutInterval = 20
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        // Wait briefly for iOS to acquire a route, then retry transient failures.
        // Reusing the exact request preserves the dispatch wave ID on a retry.
        let configuration = URLSessionConfiguration.ephemeral
        configuration.waitsForConnectivity = true
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 45
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }

        var lastTransientError: Error?
        for attempt in 0..<3 {
            if Task.isCancelled { throw CancellationError() }
            do {
                let (data, response) = try await session.data(for: request)
                guard let http = response as? HTTPURLResponse else {
                    throw ApexSovereignControlError.invalidResponse
                }
                if (200...299).contains(http.statusCode) { return data }
                if http.statusCode == 401 { throw ApexSovereignControlError.unauthorized }
                guard [408, 425, 429, 500, 502, 503, 504].contains(http.statusCode) else {
                    throw ApexSovereignControlError.server(http.statusCode)
                }
                lastTransientError = ApexSovereignControlError.server(http.statusCode)
            } catch is CancellationError {
                throw CancellationError()
            } catch let error as ApexSovereignControlError {
                switch error {
                case .server(let code) where [408, 425, 429, 500, 502, 503, 504].contains(code):
                    lastTransientError = error
                default:
                    throw error
                }
            } catch {
                lastTransientError = error
            }
            if attempt < 2 {
                try await Task.sleep(for: .seconds(attempt == 0 ? 1 : 2))
            }
        }
        throw lastTransientError ?? ApexSovereignControlError.invalidResponse
    }
}

enum ApexSovereignControlError: LocalizedError {
    case invalidURL
    case unauthorized
    case invalidResponse
    case server(Int)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Enter a valid server URL, including https://."
        case .unauthorized: return "Server rejected the control token. Check it and try again."
        case .invalidResponse: return "Server returned an unreadable response."
        case .server(let code): return "Server request failed (HTTP \(code))."
        }
    }
}
