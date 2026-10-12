import Foundation

public actor ApexMediaCache {
    public struct Policy: Sendable {
        public let maximumBytes: Int64
        public let minimumFreeBytes: Int64

        public init(maximumBytes: Int64 = 8 * 1024 * 1024 * 1024, minimumFreeBytes: Int64 = 2 * 1024 * 1024 * 1024) {
            self.maximumBytes = maximumBytes
            self.minimumFreeBytes = minimumFreeBytes
        }
    }

    private let directory: URL
    private let policy: Policy

    public init(policy: Policy = Policy()) throws {
        self.policy = policy
        self.directory = try FileManager.default.url(
            for: .cachesDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        ).appendingPathComponent("ApexMedia", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    public func store(_ source: URL, named name: String) throws -> URL {
        try enforceBudget(incomingBytes: fileSize(source))
        let destination = directory.appendingPathComponent(safeName(name))
        try? FileManager.default.removeItem(at: destination)
        try FileManager.default.copyItem(at: source, to: destination)
        return destination
    }

    public func remove(_ url: URL) throws {
        try FileManager.default.removeItem(at: url)
    }

    public func enforceBudget(incomingBytes: Int64 = 0) throws {
        let fm = FileManager.default
        let values = try fm.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey], options: [.skipsHiddenFiles])
        var entries: [(url: URL, bytes: Int64, modified: Date)] = []
        var total: Int64 = 0

        for url in values {
            let resource = try url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
            let bytes = Int64(resource.fileSize ?? 0)
            total += bytes
            entries.append((url, bytes, resource.contentModificationDate ?? .distantPast))
        }

        let free = (try? fm.attributesOfFileSystem(forPath: NSHomeDirectory())[.systemFreeSize] as? NSNumber)?.int64Value ?? Int64.max
        let target = max(0, policy.maximumBytes - incomingBytes)
        let mustFree = max(0, total - target, policy.minimumFreeBytes - free)

        if mustFree <= 0 { return }

        var freed: Int64 = 0
        for entry in entries.sorted(by: { $0.modified < $1.modified }) {
            try? fm.removeItem(at: entry.url)
            freed += entry.bytes
            if freed >= mustFree { break }
        }

        if freed < mustFree {
            throw NSError(domain: "ApexMediaCache", code: 1, userInfo: [NSLocalizedDescriptionKey: "Apex media cache cannot satisfy the configured local-space budget."])
        }
    }

    private func fileSize(_ url: URL) -> Int64 {
        (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize).map(Int64.init) ?? 0
    }

    private func safeName(_ value: String) -> String {
        let cleaned = value.replacingOccurrences(of: "/", with: "-")
        return String(cleaned.prefix(180))
    }
}
