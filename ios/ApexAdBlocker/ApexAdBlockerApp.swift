import SwiftUI

@main
struct ApexAdBlockerApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var dns = DNSSettingsController()

    var body: some Scene {
        WindowGroup {
            VStack(spacing: 18) {
                Image(systemName: iconName)
                    .font(.system(size: 58))
                    .foregroundStyle(iconColor)

                Text(dns.state.title)
                    .font(.system(size: 28, weight: .black, design: .rounded))

                Text(dns.state.detail)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)

                Button(dns.enabled || dns.configured ? "TURN OFF" : "TURN ON") {
                    dns.toggle()
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(isBusy)

                Button("REFRESH STATUS") {
                    Task { await dns.refresh() }
                }
                .buttonStyle(.bordered)

                VStack(alignment: .leading, spacing: 7) {
                    Label(
                        dns.usingDirectResolver ? "Direct DNS resolver" : "Resolver not verified",
                        systemImage: dns.usingDirectResolver ? "checkmark.circle" : "questionmark.circle"
                    )
                    Label(
                        dns.configured ? "iOS configuration installed" : "No iOS configuration installed",
                        systemImage: dns.configured ? "checkmark.circle" : "circle"
                    )
                }
                .font(.footnote)
                .frame(maxWidth: .infinity, alignment: .leading)

                Text("The app reports the actual Network Extension state. It does not guess that a saved preference means the blocker is active.")
                    .font(.footnote)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)

                if let error = dns.errorMessage {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(.red)
                        .multilineTextAlignment(.center)
                }
            }
            .padding(28)
            .onChange(of: scenePhase) { _, phase in
                guard phase == .active else { return }
                Task { await dns.refresh() }
            }
        }
    }

    private var isBusy: Bool {
        if case .checking = dns.state { return true }
        return false
    }

    private var iconName: String {
        switch dns.state {
        case .on: return "checkmark.shield.fill"
        case .configuredNeedsActivation: return "exclamationmark.shield.fill"
        case .error: return "xmark.shield.fill"
        default: return "shield"
        }
    }

    private var iconColor: Color {
        switch dns.state {
        case .on: return .green
        case .configuredNeedsActivation: return .orange
        case .error: return .red
        default: return .secondary
        }
    }
}
