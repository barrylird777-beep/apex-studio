import AppIntents

struct ApexUniversalIntent: AppIntent {
    static let title: LocalizedStringResource = "Execute Apex Locally"
    static let description = IntentDescription("Execute an Apex request using the installed local model.")

    @Parameter(title: "Request")
    var request: String

    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        let value = try await ApexLocalRuntime.shared.generate(request)
        return .result(value: value)
    }
}

struct ApexShortcuts: AppShortcutsProvider {
    @AppShortcutsBuilder
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: ApexUniversalIntent(),
            phrases: [
                "Run Apex locally in \(.applicationName)",
                "Ask Apex locally in \(.applicationName)"
            ],
            shortTitle: "Run Apex Locally",
            systemImageName: "cpu"
        )
    }
}
