import Foundation
import NetworkExtension
import Combine

@MainActor
final class DNSSettingsController: ObservableObject {
    enum ProtectionState: Equatable {
        case off
        case on
        case configuredNeedsActivation
        case checking
        case error(String)

        var title: String {
            switch self {
            case .off: return "OFF"
            case .on: return "ON"
            case .configuredNeedsActivation: return "READY, NOT ACTIVE"
            case .checking: return "CHECKING…"
            case .error: return "ERROR"
            }
        }

        var detail: String {
            switch self {
            case .off: return "System-wide DNS ad/tracker protection is off."
            case .on: return "System-wide DNS protection is active."
            case .configuredNeedsActivation: return "The configuration exists but iOS has not activated it."
            case .checking: return "Reading the actual iOS DNS configuration…"
            case .error(let message): return message
            }
        }
    }

    @Published private(set) var state: ProtectionState = .checking
    @Published private(set) var enabled = false
    @Published private(set) var configured = false
    @Published private(set) var usingDirectResolver = false
    @Published var errorMessage: String?

    private let manager = NEDNSSettingsManager.shared()
    private let directDoHURL: URL

    init() {
        let configuredURL = Bundle.main.object(forInfoDictionaryKey: "APEX_DOH_URL") as? String
        directDoHURL = URL(string: configuredURL ?? "https://dns.adguard-dns.com/dns-query")!
        Task { await refresh() }
    }

    func refresh() async {
        state = .checking
        errorMessage = nil
        do { try await load() }
        catch {
            enabled = false
            configured = false
            usingDirectResolver = false
            let message = error.localizedDescription
            errorMessage = message
            state = .error(message)
        }
    }

    func toggle() {
        if enabled || configured { disable() } else { enable() }
    }

    func enable() {
        errorMessage = nil
        manager.loadFromPreferences { [weak self] error in
            guard let self else { return }
            if let error { self.publish(error); return }

            let settings = NEDNSOverHTTPSSettings(servers: [])
            settings.serverURL = self.directDoHURL
            settings.matchDomains = [""]
            self.manager.localizedDescription = "Apex Studio Ad Blocker"
            self.manager.dnsSettings = settings

            self.manager.saveToPreferences { error in
                if let error { self.publish(error); return }
                self.refreshAfterSave()
            }
        }
    }

    func disable() {
        errorMessage = nil
        manager.loadFromPreferences { [weak self] error in
            guard let self else { return }
            if let error { self.publish(error); return }

            self.manager.removeFromPreferences { error in
                if let error { self.publish(error); return }
                Task { @MainActor in await self.refresh() }
            }
        }
    }

    private func refreshAfterSave() {
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 250_000_000)
            await refresh()
        }
    }

    private func load() async throws {
        try await withCheckedThrowingContinuation { continuation in
            manager.loadFromPreferences { [weak self] error in
                if let error { continuation.resume(throwing: error); return }
                guard let self else { continuation.resume(); return }

                let dnsSettings = self.manager.dnsSettings
                let isConfigured = dnsSettings != nil
                let isEnabled = self.manager.isEnabled == true

                self.configured = isConfigured
                self.enabled = isEnabled
                self.usingDirectResolver = isConfigured &&
                    dnsSettings?.serverURL?.host == self.directDoHURL.host

                if isEnabled {
                    self.state = .on
                } else if isConfigured {
                    self.state = .configuredNeedsActivation
                } else {
                    self.state = .off
                }

                continuation.resume()
            }
        }
    }

    private func publish(_ error: Error) {
        DispatchQueue.main.async {
            let message = error.localizedDescription
            self.errorMessage = message
            self.state = .error(message)
        }
    }
}
