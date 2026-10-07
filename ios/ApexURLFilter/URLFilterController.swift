import Combine
import Foundation
import NetworkExtension

@MainActor
final class URLFilterController: ObservableObject {
    @Published private(set) var isEnabled = false
    @Published private(set) var status = "Not configured"
    private let controlProviderBundleIdentifier = "com.barrylird777.apex.ApexURLFilterControlProvider"
    private let pirServerURL = URL(string: "https://REPLACE_WITH_APEX_PIR_HOST")!
    private let pirPrivacyPassIssuerURL: URL? = nil
    private let authenticationToken = "REPLACE_ME"

    func refresh() async {
        let manager = NEURLFilterManager.shared
        do {
            try await manager.loadFromPreferences()
            isEnabled = manager.isEnabled
            status = manager.isEnabled ? "Enabled" : "Disabled"
        } catch { status = "Not configured: \(error.localizedDescription)" }
    }

    func setEnabled(_ enabled: Bool) {
        Task { @MainActor in
            do {
                let manager = NEURLFilterManager.shared
                if enabled {
                    try manager.setConfiguration(
                        pirServerURL: pirServerURL,
                        pirPrivacyPassIssuerURL: pirPrivacyPassIssuerURL,
                        pirAuthenticationToken: authenticationToken,
                        controlProviderBundleIdentifier: controlProviderBundleIdentifier)
                }
                manager.prefilterFetchInterval = 2700
                manager.shouldFailClosed = false
                manager.isEnabled = enabled
                try await manager.saveToPreferences()
                isEnabled = enabled
                status = enabled ? "Enabled" : "Disabled"
            } catch {
                isEnabled = false
                status = "Configuration error: \(error.localizedDescription)"
            }
        }
    }
}