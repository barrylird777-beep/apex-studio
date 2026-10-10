import SwiftUI
import UniformTypeIdentifiers

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
    @State private var modelImportPresented = false
    @State private var modelStatus = "Import a GGUF model to start local inference."

    private var ggufType: UTType {
        UTType(filenameExtension: "gguf", conformingTo: .data) ?? .data
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 14) {
                Text("APEX UNIVERSAL LOCAL AI")
                    .font(.headline)
                Text("Local-first • Metal • offline-capable • Siri/Shortcuts")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Button {
                    modelImportPresented = true
                } label: {
                    Label("Import GGUF Model", systemImage: "square.and.arrow.down")
                }
                .buttonStyle(.bordered)
                .disabled(busy)

                Text(modelStatus)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)

                TextEditor(text: $prompt)
                    .frame(minHeight: 140)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(.quaternary))

                Button(busy ? "Running locally…" : "Execute") {
                    Task {
                        busy = true
                        defer { busy = false }
                        do {
                            output = try await ApexLocalRuntime.shared.generate(prompt)
                        } catch let caughtError {
                            error = caughtError.localizedDescription
                        }
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(busy || prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                ScrollView {
                    Text(output.isEmpty ? "Ready." : output)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                Spacer()
            }
            .padding()
            .navigationTitle("Apex")
            .fileImporter(
                isPresented: $modelImportPresented,
                allowedContentTypes: [ggufType],
                allowsMultipleSelection: false
            ) { result in
                do {
                    guard let sourceURL = try result.get().first else { return }
                    guard sourceURL.pathExtension.lowercased() == "gguf" else {
                        error = "Choose a .gguf model file."
                        return
                    }
                    let didStartAccessing = sourceURL.startAccessingSecurityScopedResource()
                    defer {
                        if didStartAccessing {
                            sourceURL.stopAccessingSecurityScopedResource()
                        }
                    }

                    let documents = FileManager.default.urls(
                        for: .documentDirectory,
                        in: .userDomainMask
                    )[0]
                    let originalName = sourceURL.lastPathComponent
                    let destination = uniqueDestination(
                        in: documents,
                        fileName: originalName
                    )
                    try FileManager.default.copyItem(at: sourceURL, to: destination)
                    modelStatus = "Imported \(destination.lastPathComponent). If a model is already loaded, restart Apex before switching models."
                } catch {
                    self.error = error.localizedDescription
                }
            }
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

    private func uniqueDestination(in directory: URL, fileName: String) -> URL {
        let candidate = directory.appendingPathComponent(fileName)
        guard FileManager.default.fileExists(atPath: candidate.path) else {
            return candidate
        }

        let name = candidate.deletingPathExtension().lastPathComponent
        let ext = candidate.pathExtension
        let uniqueName = "\(name)-\(UUID().uuidString).\(ext)"
        return directory.appendingPathComponent(uniqueName)
    }
}
