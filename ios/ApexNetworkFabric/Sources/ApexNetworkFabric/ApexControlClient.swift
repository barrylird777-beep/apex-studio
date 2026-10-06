import Foundation

public enum ApexControlError: Error, Sendable {
    case invalidURL
    case unauthorized
    case server(Int)
    case invalidResponse
}

public struct ApexControlClient: Sendable {
    public let baseURL: URL
    public let token: String
    private let session: URLSession

    public init(baseURL: URL, token: String, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.token = token
        self.session = session
    }

    public func status() async throws -> Data {
        try await request(path: "api/mobile/status", method: "GET")
    }

    public func network() async throws -> Data {
        try await request(path: "api/mobile/network", method: "GET")
    }

    public func workers() async throws -> Data {
        try await request(path: "api/mobile/workers", method: "GET")
    }

    public func ai() async throws -> Data {
        try await request(path: "api/mobile/ai", method: "GET")
    }

    public func produceEpisode(
        book: String,
        chapter: Int,
        verses: String = "full",
        requestID: String = UUID().uuidString
    ) async throws -> Data {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw ApexControlError.invalidURL
        }
        components.path = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/api/mobile/production/episode"
        guard let url = components.url else { throw ApexControlError.invalidURL }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(token, forHTTPHeaderField: "x-apex-shortcut-token")
        request.setValue(requestID, forHTTPHeaderField: "x-request-id")
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "book": book,
            "chapter": chapter,
            "verses": verses
        ])

        let (data, response) = try await session.data(for: request)
        try validate(response)
        return data
    }

    private func request(path: String, method: String) async throws -> Data {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw ApexControlError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue(token, forHTTPHeaderField: "x-apex-shortcut-token")
        request.setValue(UUID().uuidString, forHTTPHeaderField: "x-request-id")

        let (data, response) = try await session.data(for: request)
        try validate(response)
        return data
    }

    private func validate(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else {
            throw ApexControlError.invalidResponse
        }
        switch http.statusCode {
        case 200...299: return
        case 401: throw ApexControlError.unauthorized
        default: throw ApexControlError.server(http.statusCode)
        }
    }
}
