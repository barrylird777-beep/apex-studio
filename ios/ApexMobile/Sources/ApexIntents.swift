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

struct ApexSearchIntent: AppIntent {
    static var title: LocalizedStringResource = "Search Anything with Apex"
    static var description = IntentDescription("Search the public web from Apex.")
    @Parameter(title: "Query") var query: String
    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        .result(value: try await ApexWebSearch.search(query: query))
    }
}
enum ApexWebSearch {
    static func search(query: String) async throws -> String {
        guard let encoded=query.addingPercentEncoding(withAllowedCharacters:.urlQueryAllowed),
              let url=URL(string:"https://html.duckduckgo.com/html/?q=\(encoded)") else { throw ApexSearchError.invalidQuery }
        var request=URLRequest(url:url);request.setValue("ApexMobile/1.0",forHTTPHeaderField:"User-Agent")
        let (data,response)=try await URLSession.shared.data(for:request)
        guard let http=response as? HTTPURLResponse,(200..<300).contains(http.statusCode) else { throw ApexSearchError.network }
        let html=String(data:data,encoding:.utf8) ?? ""
        let pattern=try NSRegularExpression(pattern:#"<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)</a>"#)
        let range=NSRange(html.startIndex...,in:html);var lines:[String]=[]
        for m in pattern.matches(in:html,range:range).prefix(20) {
            guard let ur=Range(m.range(at:1),in:html),let tr=Range(m.range(at:2),in:html) else { continue }
            let title=String(html[tr]).replacingOccurrences(of:"<[^>]+>",with:"",options:.regularExpression)
            lines.append("\(title) — \(html[ur])")
        }
        return lines.isEmpty ? "No results found." : lines.joined(separator:"\n")
    }
}
enum ApexSearchError: Error { case invalidQuery, network }

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
            ),
            AppShortcut(intent: ApexSearchIntent(), phrases: ["Search anything with \.applicationName", "Search the web with \.applicationName"], shortTitle: "Search Anything", systemImageName: "magnifyingglass"
        ]
    }
}
