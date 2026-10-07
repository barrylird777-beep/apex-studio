import Foundation
import NetworkExtension

final class ApexURLFilterControlProvider: NSObject, NEURLFilterControlProvider {
    func start() async throws {}

    func stop(reason: NEProviderStopReason) async throws {}

    func fetchPrefilter(existingPrefilterTag: String?) async throws -> NEURLFilterPrefilter? {
        nil
    }
}
