import Foundation
import NetworkExtension

final class ApexURLFilterControlProvider: NSObject, NEURLFilterControlProvider {
    @MainActor
    override init() {
        super.init()
    }

    private let blockedValues = [
        "doubleclick.net", "googlesyndication.com", "googleadservices.com", "googletagmanager.com",
        "googletagservices.com", "adservice.google.com", "adsrvr.org", "adnxs.com", "taboola.com",
        "outbrain.com", "scorecardresearch.com", "zedo.com", "rubiconproject.com", "criteo.com",
        "pubmatic.com", "openx.net", "app-measurement.com"
    ]
    func start() async throws {}
    func stop(reason: NEProviderStopReason) async throws {}
    func fetchPrefilter(existingPrefilterTag: String?) async throws -> NEURLFilterPrefilter? {
        let filter = ApexBloomFilter(values: blockedValues)
        if existingPrefilterTag == filter.tag { return nil }
        let fileURL = FileManager.default.temporaryDirectory.appendingPathComponent("apex-url-filter-\(filter.tag).bin")
        try filter.bits.write(to: fileURL, options: .atomic)
        let data: NEURLFilterPrefilter.PrefilterData = .temporaryFilepath(fileURL)
        return NEURLFilterPrefilter(data: data, tag: filter.tag, bitCount: filter.bitCount, hashCount: filter.hashCount, murmurSeed: filter.murmurSeed)
    }
}
