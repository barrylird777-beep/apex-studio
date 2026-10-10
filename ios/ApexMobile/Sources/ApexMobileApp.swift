import SwiftUI

@main
struct ApexMobileApp: App {
    var body: some Scene {
        WindowGroup { ApexRootView() }
    }
}

struct ApexRootView: View {
    @State private var prompt = ""
    @State private var output = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            VStack(spacing: 14) {
                Text("APEX UNIVERSAL LOCAL AI")
                    .font(.headline)
                Text("Local-first • Metal • offline-capable • Siri/Shortcuts")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                TextEditor(text: $prompt)
                    .frame(minHeight: 140)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(.quaternary))

                Button(busy ? "Running locally…" : "Execute") {
                    Task {
                        busy = true
                        defer { busy = false }
                        do { output = try await ApexLocalRuntime.shared.generate(prompt) }
                        catch let caughtError { error = caughtError.localizedDescription }
                    }
                }
                .buttonStyle(.borderedProminent)

                ScrollView {
                    Text(output.isEmpty ? "Ready." : output)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                Spacer()
            }
            .padding()
            .navigationTitle("Apex")
            .alert("Apex", isPresented: Binding(
                get: { error != nil },
                set: { if !$0 { error = nil } }
            )) {
                Button("OK") { error = nil }
            } message: {
                Text(error ?? "")
            }
        }
    }
}
