import SwiftUI

@main
struct ApexURLFilterApp: App {
    @StateObject private var controller = URLFilterController()

    var body: some Scene {
        WindowGroup {
            ContentView(controller: controller)
        }
    }
}

private struct ContentView: View {
    @ObservedObject var controller: URLFilterController

    var body: some View {
        NavigationStack {
            Form {
                Section("Apex AdBlock") {
                    Toggle("URL filtering", isOn: Binding(
                        get: { controller.isEnabled },
                        set: { controller.setEnabled($0) }
                    ))
                    LabeledContent("Policy", value: "Allow by default")
                    LabeledContent("DNS fallback", value: "Enabled")
                    LabeledContent("Main-frame navigation", value: "Always allowed")
                }
                Section {
                    Text(controller.status).font(.footnote)
                }
            }
            .navigationTitle("Apex AdBlock")
        }
        .task { await controller.refresh() }
    }
}