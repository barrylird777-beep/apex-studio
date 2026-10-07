import SwiftUI
import UniformTypeIdentifiers

@main
struct ApexMobileApp: App {
    var body: some Scene { WindowGroup { ApexRootView() } }
}

struct ApexRootView: View {
    @State private var prompt=""
    @State private var output=""
    @State private var busy=false
    @State private var importing=false
    @State private var error:String?

    var body: some View {
        NavigationStack {
            VStack(spacing:12) {
                Text("APEX MOBILE").font(.headline)
                Text("Local AI • Metal • offline • Shortcuts")
                    .font(.caption).foregroundStyle(.secondary)

                HStack {
                    Button("Install GGUF") { importing=true }
                        .buttonStyle(.bordered)
                    Button("Unload") { Task { await ApexLocalRuntime.shared.unload() } }
                        .buttonStyle(.bordered)
                }

                TextEditor(text:$prompt)
                    .frame(minHeight:160)
                    .overlay(RoundedRectangle(cornerRadius:12).stroke(.quaternary))

                Button(busy ? "Running locally…" : "Execute locally") {
                    Task { await execute(prompt) }
                }
                .buttonStyle(.borderedProminent)
                .disabled(busy || prompt.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty)

                ScrollView {
                    Text(output.isEmpty ? "Ready. Install a GGUF model to begin." : output)
                        .frame(maxWidth:.infinity,alignment:.leading)
                        .textSelection(.enabled)
                }
                Spacer()
            }
            .padding()
            .navigationTitle("Apex")
            .fileImporter(
                isPresented:$importing,
                allowedContentTypes:[UTType(filenameExtension:"gguf") ?? .data],
                allowsMultipleSelection:false
            ) { result in
                switch result {
                case .success(let urls):
                    guard let url=urls.first else { return }
                    Task {
                        do { try await ApexLocalRuntime.shared.installModel(from:url) }
                        catch { error=error.localizedDescription }
                    }
                case .failure(let e):
                    error=e.localizedDescription
                }
            }
            .alert("Apex",isPresented:Binding(get:{error != nil},set:{if !$0{error=nil}})) {
                Button("OK"){error=nil}
            } message:{Text(error ?? "")}
        }
    }

    @MainActor
    private func execute(_ request:String) async {
        busy=true; defer{busy=false}
        do { output=try await ApexLocalRuntime.shared.generate(request) }
        catch { error=error.localizedDescription }
    }
}
