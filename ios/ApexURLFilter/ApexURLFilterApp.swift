import SwiftUI

@main
struct ApexURLFilterApp: App {
    @StateObject private var controller = URLFilterController()
    var body: some Scene {
        WindowGroup {
            NavigationStack {
                Form {
                    Section("Apex AdBlock") {
                        Toggle("URL filtering", isOn: Binding(get: { controller.isEnabled }, set: { controller.setEnabled($0) }))
                        LabeledContent("Policy", value: "Allow by default")
                        LabeledContent("Site navigation", value: "Always allowed")
                        LabeledContent("Filter", value: "Ad / tracker resources")
                    }
                    Section("Status") { Text(controller.status).font(.footnote) }
                }.navigationTitle("Apex AdBlock")
            }
        }.task { await controller.refresh() }
    }
}