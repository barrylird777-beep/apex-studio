import Foundation

struct ApexSovereignApp: Decodable, Identifiable {
    let id: String
    let name: String
    let role: String
    let entry: String
}

struct ApexSovereignControlClient {
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
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw ApexSovereignControlError.invalidResponse }
        guard (200...299).contains(http.statusCode) else {
            if http.statusCode == 401 { throw ApexSovereignControlError.unauthorized }
            throw ApexSovereignControlError.server(http.statusCode)
        }
        return data
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
