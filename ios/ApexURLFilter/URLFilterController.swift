import Foundation
import NetworkExtension

@MainActor
final class URLFilterController: ObservableObject {
    @Published private(set) var isEnabled = false
    @Published private(set) var status = "Not configured"

    private let pirServerURL = URL(string: "https://REPLACE_WITH_APEX_PIR_HOST")!
    private let pirPrivacyPassIssuerURL = URL(string: "https://REPLACE_WITH_APEX_PIR_ISSUER_HOST")!
    private let authenticationToken = "REPLACE_ME"
    private let controlProviderBundleIdentifier =
        "com.barrylird777.apex.ApexURLFilterControlProvider"

    func refresh() async {
        let manager = NEURLFilterManager.shared
        isEnabled = manager.isEnabled
        status = manager.isEnabled ? "Enabled" : "Disabled"
    }

    func setEnabled(_ enabled: Bool) {
        Task {
            do {
                let manager = NEURLFilterManager.shared
                if enabled {
                    try await manager.setConfiguration(
                        pirServerURL: pirServerURL,
                        pirPrivacyPassIssuerURL: pirPrivacyPassIssuerURL,
                        pirAuthenticationToken: authenticationToken,
                        controlProviderBundleIdentifier: controlProviderBundleIdentifier
                    )
                }
                manager.isEnabled = enabled
                try await manager.saveToPreferences()
                isEnabled = enabled
                status = enabled ? "Enabled" : "Disabled"
            } catch {
                isEnabled = false
                status = "Configuration required: \(error.localizedDescription)"
            }
        }
    }
}