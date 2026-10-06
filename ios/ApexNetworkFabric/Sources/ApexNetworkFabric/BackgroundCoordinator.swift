import Foundation
import BackgroundTasks

public final class ApexBackgroundCoordinator {
    public static let refreshIdentifier = "com.apex.studio.network.refresh"

    public static func register() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: refreshIdentifier, using: nil) { task in
            task.setTaskCompleted(success: true)
            schedule()
        }
    }

    public static func schedule() {
        let request = BGAppRefreshTaskRequest(identifier: refreshIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }
}
