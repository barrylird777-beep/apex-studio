import Foundation
import BackgroundTasks

public final class ApexBackgroundCoordinator {
    public static let refreshIdentifier = "com.apex.studio.network.refresh"

    private let operation: @Sendable () async -> Bool

    public init(operation: @escaping @Sendable () async -> Bool) {
        self.operation = operation
    }

    public func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.refreshIdentifier, using: nil) { [operation] task in
            guard let refreshTask = task as? BGAppRefreshTask else {
                task.setTaskCompleted(success: false)
                return
            }

            Self.schedule()
            Task {
                let success = await operation()
                refreshTask.setTaskCompleted(success: success)
            }
        }
    }

    public static func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: refreshIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }
}
