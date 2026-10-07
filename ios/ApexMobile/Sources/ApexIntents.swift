import AppIntents

struct ApexUniversalIntent: AppIntent, LongRunningIntent, CancellableIntent {
    static var title: LocalizedStringResource = "Execute Apex Locally"
    static var description = IntentDescription("Execute an Apex request using the installed local model.")
    static var supportedModes: IntentModes { .background }

    @Parameter(title: "Request")
    var request: String

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let value = try await performBackgroundTask {
            progress.totalUnitCount = 1
            try Task.checkCancellation()
            let result = try await ApexLocalRuntime.shared.generate(request)
            progress.completedUnitCount = 1
            progress.localizedAdditionalDescription = "Completed on device"
            return result
        }
        return .result(value: value)
    }
}

struct ApexShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        [
            AppShortcut(
                intent: ApexUniversalIntent(),
                phrases: [
                    "Run Apex locally in \(.applicationName)",
                    "Ask Apex locally in \(.applicationName)"
                ],
                shortTitle: "Run Apex Locally",
                systemImageName: "cpu"
            )
        ]
    }
}
