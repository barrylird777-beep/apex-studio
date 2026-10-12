import Foundation
import Network
import Combine

/// Reports iOS path availability only; it does not claim that a route reaches the public internet.
public final class ApexPhoneConnectivity: ObservableObject, @unchecked Sendable {
    @Published public private(set) var systemRoute = "Checking…"
    @Published public private(set) var wifiRoute = "Checking…"
    @Published public private(set) var cellularRoute = "Checking…"

    private let systemMonitor = NWPathMonitor()
    private let wifiMonitor = NWPathMonitor(requiredInterfaceType: .wifi)
    private let cellularMonitor = NWPathMonitor(requiredInterfaceType: .cellular)
    private let systemQueue = DispatchQueue(label: "com.apex.mobile.path.system")
    private let wifiQueue = DispatchQueue(label: "com.apex.mobile.path.wifi")
    private let cellularQueue = DispatchQueue(label: "com.apex.mobile.path.cellular")

    public init() {
        systemMonitor.pathUpdateHandler = { [weak self] path in
            let value = Self.describe(path, label: "System route")
            DispatchQueue.main.async { self?.systemRoute = value }
        }
        wifiMonitor.pathUpdateHandler = { [weak self] path in
            let value = Self.describe(path, label: "Wi-Fi")
            DispatchQueue.main.async { self?.wifiRoute = value }
        }
        cellularMonitor.pathUpdateHandler = { [weak self] path in
            let value = Self.describe(path, label: "Cellular")
            DispatchQueue.main.async { self?.cellularRoute = value }
        }
        systemMonitor.start(queue: systemQueue)
        wifiMonitor.start(queue: wifiQueue)
        cellularMonitor.start(queue: cellularQueue)
    }

    deinit {
        systemMonitor.cancel()
        wifiMonitor.cancel()
        cellularMonitor.cancel()
    }

    private static func describe(_ path: NWPath, label: String) -> String {
        let status: String
        switch path.status {
        case .satisfied: status = "available"
        case .requiresConnection: status = "requires connection"
        case .unsatisfied: status = "unavailable"
        @unknown default: status = "unknown"
        }
        if label == "System route" {
            let interface: String
            if path.usesInterfaceType(.wifi) { interface = "Wi-Fi" }
            else if path.usesInterfaceType(.cellular) { interface = "cellular" }
            else if path.usesInterfaceType(.wiredEthernet) { interface = "wired Ethernet" }
            else if path.usesInterfaceType(.other) { interface = "other" }
            else { interface = "none selected" }
            return "\(status) • \(interface)"
        }
        return "\(status) • iOS path status only"
    }
}
