import Foundation

public struct ApexPhoneVaultClient: Sendable {
    public let baseURL: URL
    public let token: String
    private let session: URLSession

    public init(baseURL: URL, token: String, session: URLSession = .shared) {
        self.baseURL = baseURL
        self.token = token
        self.session = session
    }

    public func status() async throws -> Data {
        try await request(path: "api/phone/status", method: "GET")
    }

    public func storageStatus() async throws -> Data {
        try await request(path: "api/phone/storage/status", method: "GET")
    }

    public func storageObjects(limit: Int = 100, cursor: String? = nil) async throws -> Data {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw ApexControlError.invalidURL
        }
        components.path = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/api/phone/storage"
        components.queryItems = [
            URLQueryItem(name: "limit", value: String(limit)),
            ...(cursor.map { [URLQueryItem(name: "cursor", value: $0)] } ?? [])
        ]
        guard let url = components.url else { throw ApexControlError.invalidURL }
        return try await request(url: url, method: "GET")
    }

    public func uploadLargeFile(
        at fileURL: URL,
        filename: String? = nil,
        contentType: String = "application/octet-stream"
    ) async throws -> Data {
        let attributes = try FileManager.default.attributesOfItem(atPath: fileURL.path)
        let size = (attributes[.size] as? NSNumber)?.int64Value ?? 0

        let initData = try await postJSON(path: "api/phone/storage/multipart/initiate", body: [
            "filename": filename ?? fileURL.lastPathComponent,
            "contentType": contentType,
            "size": size
        ])

        struct Session: Codable {
            let key: String
            let uploadId: String
            let partSize: Int
            let partCount: Int
        }
        struct PartsEnvelope: Codable { let parts: [Part] }
        struct Part: Codable { let partNumber: Int; let etag: String; let bytes: Int }
        struct Ticket: Codable { let url: URL }

        let upload = try JSONDecoder().decode(Session.self, from: initData)
        let existingData = try await postJSON(path: "api/phone/storage/multipart/parts", body: [
            "key": upload.key, "uploadId": upload.uploadId
        ])
        let existing = try JSONDecoder().decode(PartsEnvelope.self, from: existingData)
        var completed = Dictionary(uniqueKeysWithValues: existing.parts.map { ($0.partNumber, $0.etag) })

        do {
            let handle = try FileHandle(forReadingFrom: fileURL)
            defer { try? handle.close() }

            for partNumber in 1...max(1, upload.partCount) {
                if completed[partNumber] != nil { continue }
                let offset = UInt64((partNumber - 1) * upload.partSize)
                let remaining = UInt64(max(0, size - Int64(offset)))
                if remaining == 0 { break }
                let length = Int(min(UInt64(upload.partSize), remaining))
                try handle.seek(toOffset: offset)

                let temp = FileManager.default.temporaryDirectory.appendingPathComponent("apex-phone-part-(UUID().uuidString)")
                try copyChunk(from: handle, to: temp, length: length)
                defer { try? FileManager.default.removeItem(at: temp) }

                let ticketData = try await postJSON(path: "api/phone/storage/multipart/part-url", body: [
                    "key": upload.key, "uploadId": upload.uploadId, "partNumber": partNumber
                ])
                let ticket = try JSONDecoder().decode(Ticket.self, from: ticketData)

                var request = URLRequest(url: ticket.url)
                request.httpMethod = "PUT"
                request.setValue(contentType, forHTTPHeaderField: "Content-Type")
                let (_, response) = try await session.upload(for: request, fromFile: temp)
                guard let http = response as? HTTPURLResponse,
                      (200...299).contains(http.statusCode),
                      let etag = http.value(forHTTPHeaderField: "ETag") else {
                    throw ApexControlError.server((response as? HTTPURLResponse)?.statusCode ?? 0)
                }
                completed[partNumber] = etag
            }

            let parts = completed.keys.sorted().map { [
                "partNumber": $0,
                "etag": completed[$0] ?? ""
            ] }
            return try await postJSON(path: "api/phone/storage/multipart/complete", body: [
                "key": upload.key, "uploadId": upload.uploadId, "parts": parts
            ])
        } catch {
            _ = try? await postJSON(path: "api/phone/storage/multipart/abort", body: [
                "key": upload.key, "uploadId": upload.uploadId
            ])
            throw error
        }
    }

    private func copyChunk(from source: FileHandle, to destination: URL, length: Int) throws {
        FileManager.default.createFile(atPath: destination.path, contents: nil)
        let output = try FileHandle(forWritingTo: destination)
        defer { try? output.close() }
        var remaining = length
        while remaining > 0 {
            let data = try source.read(upToCount: min(8 * 1024 * 1024, remaining)) ?? Data()
            if data.isEmpty { throw ApexControlError.invalidResponse }
            try output.write(contentsOf: data)
            remaining -= data.count
        }
    }

    private func postJSON(path: String, body: [String: Any]) async throws -> Data {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw ApexControlError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(token, forHTTPHeaderField: "x-apex-shortcut-token")
        request.setValue(UUID().uuidString, forHTTPHeaderField: "x-request-id")
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await session.data(for: request)
        try validate(response)
        return data
    }

    private func request(path: String, method: String) async throws -> Data {
        guard let url = URL(string: path, relativeTo: baseURL)?.absoluteURL else {
            throw ApexControlError.invalidURL
        }
        return try await request(url: url, method: method)
    }

    private func request(url: URL, method: String) async throws -> Data {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue(token, forHTTPHeaderField: "x-apex-shortcut-token")
        request.setValue(UUID().uuidString, forHTTPHeaderField: "x-request-id")
        let (data, response) = try await session.data(for: request)
        try validate(response)
        return data
    }

    private func validate(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { throw ApexControlError.invalidResponse }
        switch http.statusCode {
        case 200...299: return
        case 401: throw ApexControlError.unauthorized
        default: throw ApexControlError.server(http.statusCode)
        }
    }
}
