import Foundation

/// File-system inventory for local GGUF models. This does not claim that a model
/// architecture is supported; llama.cpp remains the final compatibility check.
struct ApexModelFile: Identifiable, Sendable {
    let id: String
    let url: URL
    let sizeBytes: Int64
    let ggufVersion: UInt32
    let tensorCount: UInt64
    let metadataCount: UInt64

    var displaySize: String {
        ByteCountFormatter.string(fromByteCount: sizeBytes, countStyle: .file)
    }
}

enum ApexModelCatalogError: LocalizedError {
    case notGGUF
    case unreadableHeader
    case unsupportedVersion(UInt32)
    case incompleteHeader
    case insufficientStorage(required: Int64, available: Int64)

    var errorDescription: String? {
        switch self {
        case .notGGUF: return "This file is not a GGUF model."
        case .unreadableHeader: return "The GGUF header could not be read."
        case .unsupportedVersion(let version): return "GGUF version \(version) is not supported by this catalog."
        case .incompleteHeader: return "The GGUF header is incomplete or invalid."
        case .insufficientStorage(let required, let available):
            return "Not enough free storage. Required about \(ByteCountFormatter.string(fromByteCount: required, countStyle: .file)); available \(ByteCountFormatter.string(fromByteCount: available, countStyle: .file))."
        }
    }
}

enum ApexModelCatalog {
    static var directory: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    static func inventory() -> [ApexModelFile] {
        let urls = (try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: [.fileSizeKey, .isRegularFileKey],
            options: [.skipsHiddenFiles]
        )) ?? []

        return urls.compactMap { url in
            guard url.pathExtension.lowercased() == "gguf",
                  let values = try? url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey]),
                  values.isRegularFile == true,
                  let size = values.fileSize,
                  let header = try? inspect(url: url) else { return nil }
            return ApexModelFile(
                id: url.lastPathComponent,
                url: url,
                sizeBytes: Int64(size),
                ggufVersion: header.version,
                tensorCount: header.tensorCount,
                metadataCount: header.metadataCount
            )
        }
        .sorted { $0.id.localizedStandardCompare($1.id) == .orderedAscending }
    }

    /// Validates the GGUF magic and fixed header without modifying the source file.
    /// Full metadata and architecture compatibility are checked by the inference runtime.
    static func inspect(url: URL) throws -> (version: UInt32, tensorCount: UInt64, metadataCount: UInt64) {
        guard url.pathExtension.lowercased() == "gguf" else { throw ApexModelCatalogError.notGGUF }
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        guard let data = try handle.read(upToCount: 24), data.count == 24 else {
            throw ApexModelCatalogError.unreadableHeader
        }
        let bytes = [UInt8](data)
        guard Array(bytes[0..<4]) == [0x47, 0x47, 0x55, 0x46] else {
            throw ApexModelCatalogError.notGGUF
        }
        func u32(_ start: Int) -> UInt32 {
            UInt32(bytes[start]) | (UInt32(bytes[start + 1]) << 8) |
            (UInt32(bytes[start + 2]) << 16) | (UInt32(bytes[start + 3]) << 24)
        }
        func u64(_ start: Int) -> UInt64 {
            (0..<8).reduce(UInt64(0)) { $0 | (UInt64(bytes[start + $1]) << ($1 * 8)) }
        }
        let version = u32(4)
        guard (2...3).contains(version) else { throw ApexModelCatalogError.unsupportedVersion(version) }
        let tensors = u64(8)
        let metadata = u64(16)
        guard tensors > 0, metadata > 0 else { throw ApexModelCatalogError.incompleteHeader }
        return (version, tensors, metadata)
    }

    static func availableBytes() -> Int64 {
        let values = try? directory.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        if let capacity = values?.volumeAvailableCapacityForImportantUsage { return capacity }
        let fallback = try? directory.resourceValues(forKeys: [.volumeAvailableCapacityKey])
        return Int64(fallback?.volumeAvailableCapacity ?? 0)
    }

    /// A conservative screening heuristic, not a guarantee of runtime memory use.
    static func estimatedWorkingSetBytes(modelBytes: Int64) -> Int64 {
        let (estimate, overflow) = modelBytes.multipliedReportingOverflow(by: 2)
        return overflow ? Int64.max : estimate
    }

    static func validateImport(source: URL, sizeBytes: Int64) throws {
        _ = try inspect(url: source)
        let available = availableBytes()
        // Keep a second model-size worth of free space for temporary/runtime needs.
        let (required, overflow) = sizeBytes.multipliedReportingOverflow(by: 2)
        guard !overflow, available >= required else {
            throw ApexModelCatalogError.insufficientStorage(required: overflow ? Int64.max : required, available: available)
        }
    }
}
