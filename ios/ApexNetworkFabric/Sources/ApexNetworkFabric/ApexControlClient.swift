import Foundation

public enum ApexControlError: Error, Sendable {
    case invalidURL
    case unauthorized
    case server(Int)
    case invalidResponse
}

public struct ApexStorageObject: Codable, Sendable {
    public let key: String
    public let bytes: Int
    public let modifiedAt: String?
    public let etag: String?
}

public struct ApexStorageStatus: Codable, Sendable {
    public let configured: Bool
    public let provider: String
    public let bucket: String?
    public let region: String?
    public let endpoint: String?
    public let deviceMode: String
    public let localDeviceStorageRole: String
}

public struct ApexStorageUploadTicket: Codable, Sendable {
    public let key: String
    public let url: URL
    public let expiresIn: Int
    public let maxBytes: Int
}

public struct ApexStorageDownloadTicket: Codable, Sendable {
    public let key: String
    public let url: URL
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

    public func storageStatus() async throws -> ApexStorageStatus {
        try await decode(path: "api/mobile/storage/status", method: "GET", as: ApexStorageStatus.self)
    }

    public func storageObjects(prefix: String = "iphone", limit: Int = 100) async throws -> [ApexStorageObject] {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw ApexControlError.invalidURL
        }
        components.path = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/api/mobile/storage"
        components.queryItems = [
            URLQueryItem(name: "prefix", value: prefix),
            URLQueryItem(name: "limit", value: String(limit))
        ]
        guard let url = components.url else { throw ApexControlError.invalidURL }
        let data = try await request(url: url, method: "GET")
        struct Envelope: Codable { let objects: [ApexStorageObject] }
        return try JSONDecoder().decode(Envelope.self, from: data).objects
    }

    public func uploadFile(
        at fileURL: URL,
        filename: String? = nil,
        contentType: String = "application/octet-stream",
        prefix: String = "iphone"
    ) async throws -> ApexStorageObject {
        let attributes = try FileManager.default.attributesOfItem(atPath: fileURL.path)
        let size = (attributes[.size] as? NSNumber)?.intValue ?? 0
        let ticketData = try await postJSON(
            path: "api/mobile/storage/upload-url",
            body: [
                "filename": filename ?? fileURL.lastPathComponent,
                "contentType": contentType,
                "size": size,
                "prefix": prefix
            ]
        )
        let envelope = try JSONDecoder().decode(UploadEnvelope.self, from: ticketData)
        var upload = URLRequest(url: envelope.url)
        upload.httpMethod = "PUT"
        upload.setValue(contentType, forHTTPHeaderField: "Content-Type")
        let (responseData, response) = try await session.upload(for: upload, fromFile: fileURL)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw ApexControlError.server((response as? HTTPURLResponse)?.statusCode ?? 0)
        }
        _ = responseData
        return ApexStorageObject(key: envelope.key, bytes: size, modifiedAt: nil, etag: nil)
    }

    public func downloadURL(for key: String, prefix: String = "iphone") async throws -> URL {
        let data = try await postJSON(
            path: "api/mobile/storage/download-url",
            body: ["key": key, "prefix": prefix]
        )
        let envelope = try JSONDecoder().decode(DownloadEnvelope.self, from: data)
        return envelope.url
    }

    public func deleteStorageObject(key: String, prefix: String = "iphone") async throws {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw ApexControlError.invalidURL
        }
        components.path = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/api/mobile/storage"
        components.queryItems = [
            URLQueryItem(name: "key", value: key),
            URLQueryItem(name: "prefix", value: prefix)
        ]
        guard let url = components.url else { throw ApexControlError.invalidURL }
        _ = try await request(url: url, method: "DELETE")
    }

    public func uploadLargeFile(
        at fileURL: URL,
        filename: String? = nil,
        contentType: String = "application/octet-stream",
        prefix: String = "iphone"
    ) async throws -> ApexStorageObject {
        let attributes = try FileManager.default.attributesOfItem(atPath: fileURL.path)
        let size = Int64((attributes[.size] as? NSNumber)?.int64Value ?? 0)
        let initData = try await postJSON(
            path: "api/mobile/storage/multipart/initiate",
            body: [
                "filename": filename ?? fileURL.lastPathComponent,
                "contentType": contentType,
                "size": size,
                "prefix": prefix
            ]
        )
        let session = try JSONDecoder().decode(MultipartSession.self, from: initData)
        let existingData = try await postJSON(
            path: "api/mobile/storage/multipart/parts",
            body: ["key": session.key, "uploadId": session.uploadId, "prefix": prefix]
        )
        let existing = try JSONDecoder().decode(MultipartPartsEnvelope.self, from: existingData)
        var completed = Dictionary(uniqueKeysWithValues: existing.parts.map { ($0.partNumber, $0.etag) })

        do {
            let handle = try FileHandle(forReadingFrom: fileURL)
            defer { try? handle.close() }
            var partNumber = 1
            while Int64((partNumber - 1) * session.partSize) < size {
                if completed[partNumber] == nil {
                    let offset = UInt64((partNumber - 1) * session.partSize)
                    let remaining = UInt64(max(0, size - Int64(offset)))
                    let length = Int(min(UInt64(session.partSize), remaining))
                    try handle.seek(toOffset: offset)
                    let temp = FileManager.default.temporaryDirectory.appendingPathComponent("apex-part-\(UUID().uuidString)")
                    try copyChunk(from: handle, to: temp, length: length)
                    defer { try? FileManager.default.removeItem(at: temp) }

                    let ticketData = try await postJSON(
                        path: "api/mobile/storage/multipart/part-url",
                        body: [
                            "key": session.key,
                            "uploadId": session.uploadId,
                            "partNumber": partNumber,
                            "prefix": prefix
                        ]
                    )
                    let ticket = try JSONDecoder().decode(MultipartPartTicket.self, from: ticketData)
                    var request = URLRequest(url: ticket.url)
                    request.httpMethod = "PUT"
                    request.setValue(contentType, forHTTPHeaderField: "Content-Type")
                    let (_, response) = try await URLSession.shared.upload(for: request, fromFile: temp)
                    guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode),
                          let etag = http.value(forHTTPHeaderField: "ETag") else {
                        throw ApexControlError.server((response as? HTTPURLResponse)?.statusCode ?? 0)
                    }
                    completed[partNumber] = etag
                }
                partNumber += 1
            }
            let parts = completed.keys.sorted().map { ["partNumber": $0, "etag": completed[$0] ?? ""] }
            let completeData = try await postJSON(
                path: "api/mobile/storage/multipart/complete",
                body: ["key": session.key, "uploadId": session.uploadId, "parts": parts, "prefix": prefix]
            )
            _ = try JSONSerialization.jsonObject(with: completeData)
            return ApexStorageObject(key: session.key, bytes: Int(min(size, Int64(Int.max))), modifiedAt: nil, etag: nil)
        } catch {
            _ = try? await postJSON(
                path: "api/mobile/storage/multipart/abort",
                body: ["key": session.key, "uploadId": session.uploadId, "prefix": prefix]
            )
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

    private struct MultipartSession: Codable {
        let key: String
        let uploadId: String
        let partSize: Int
        let partCount: Int
    }

    private struct MultipartPartTicket: Codable {
        let key: String
        let uploadId: String
        let partNumber: Int
        let url: URL
        let expiresIn: Int
    }

    private struct MultipartPartsEnvelope: Codable {
        let parts: [MultipartPart]
    }

    private struct MultipartPart: Codable {
        let partNumber: Int
        let etag: String
        let bytes: Int
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

    private struct UploadEnvelope: Codable {
        let key: String
        let url: URL
        let expiresIn: Int
        let maxBytes: Int
    }

    private struct DownloadEnvelope: Codable {
        let key: String
        let url: URL
    }

    private func decode<T: Decodable>(path: String, method: String, as type: T.Type) async throws -> T {
        try JSONDecoder().decode(T.self, from: request(path: path, method: method))
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
