import Foundation
import Network

public struct ApexNetworkSnapshot: Sendable {
    public let status: String
    public let interface: String?
    public let isExpensive: Bool
    public let isConstrained: Bool
    public let checkedAt: Date

    public init(
        status: String,
        interface: String?,
        isExpensive: Bool,
        isConstrained: Bool,
        checkedAt: Date = Date()
    ) {
        self.status = status
        self.interface = interface
        self.isExpensive = isExpensive
        self.isConstrained = isConstrained
        self.checkedAt = checkedAt
    }
}

public final class ApexNetworkMonitor: @unchecked Sendable {
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "com.apex.studio.network-monitor")
    private let lock = NSLock()
    private var current = ApexNetworkSnapshot(
        status: "unknown",
        interface: nil,
        isExpensive: false,
        isConstrained: false
    )

    public init() {}

    deinit {
        monitor.cancel()
    }

    public func start() {
        monitor.pathUpdateHandler = { [weak self] path in
            guard let self else { return }
            let snapshot = ApexNetworkSnapshot(
                status: Self.status(for: path.status),
                interface: Self.interface(for: path),
                isExpensive: path.isExpensive,
                isConstrained: path.isConstrained
            )
            self.lock.lock()
            self.current = snapshot
            self.lock.unlock()
        }
        monitor.start(queue: queue)
    }

    public func stop() {
        monitor.cancel()
    }

    public func snapshot() -> ApexNetworkSnapshot {
        lock.lock()
        defer { lock.unlock() }
        return current
    }

    private static func status(for status: NWPath.Status) -> String {
        switch status {
        case .satisfied: return "connected"
        case .requiresConnection: return "requires-connection"
        case .unsatisfied: return "offline"
        @unknown default: return "unknown"
        }
    }

    private static func interface(for path: NWPath) -> String? {
        if path.usesInterfaceType(.wifi) { return "wifi" }
        if path.usesInterfaceType(.cellular) { return "cellular" }
        if path.usesInterfaceType(.wiredEthernet) { return "ethernet" }
        if path.usesInterfaceType(.loopback) { return "loopback" }
        if path.usesInterfaceType(.other) { return "other" }
        return nil
    }
}
