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
    @State private var models: [ApexModelFile] = []
    @State private var selectedModelID: String?
    @State private var lastInferenceMilliseconds: Int?
    @State private var lastRunLabel = "No inference run recorded"

    private var ggufType: UTType {
        UTType(filenameExtension: "gguf", conformingTo: .data) ?? .data
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 14) {
                Text("APEX UNIVERSAL LOCAL AI").font(.headline)
                Text("On-device inference • Metal when supported • offline-capable")
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

                GroupBox("Local model inventory") {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Available storage")
                            Spacer()
                            Text(ByteCountFormatter.string(fromByteCount: ApexModelCatalog.availableBytes(), countStyle: .file))
                                .monospacedDigit()
                        }
                        if models.isEmpty {
                            Text("No valid GGUF headers found.")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        } else {
                            ForEach(models) { model in
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(model.id).font(.subheadline).lineLimit(2)
                                    Text("\(model.displaySize) • GGUF v\(model.ggufVersion) • \(model.tensorCount) tensors • header valid")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                    Text("Estimated working set: \(ByteCountFormatter.string(fromByteCount: ApexModelCatalog.estimatedWorkingSetBytes(modelBytes: model.sizeBytes), countStyle: .memory)) • rough estimate only")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                    Button(selectedModelID == model.id ? "Selected for inference" : "Use this model") {
                                        selectedModelID = model.id
                                    }
                                    .font(.caption)
                                    .disabled(busy)
                                }
                                .frame(maxWidth: .infinity, alignment: .leading)
                                Divider()
                            }
                        }
                        Button("Refresh inventory") { refreshInventory() }
                            .font(.footnote)
                    }
                }

                TextEditor(text: $prompt)
                    .frame(minHeight: 110)
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(.quaternary))

                Button(busy ? "Running locally…" : "Execute") {
                    Task {
                        busy = true
                        error = nil
                        defer { busy = false }
                        let start = ContinuousClock.now
                        do {
                            let modelPath = models.first(where: { $0.id == selectedModelID })?.url.path
                            let result = try await ApexLocalRuntime.shared.generate(prompt, modelPath: modelPath)
                            output = result
                            let elapsed = start.duration(to: .now)
                            let components = elapsed.components
                            let milliseconds = Int(components.seconds * 1000 + components.attoseconds / 1_000_000_000_000_000)
                            lastInferenceMilliseconds = milliseconds
                            lastRunLabel = "Inference completed • \(milliseconds) ms • response characters: \(result.count)"
                        } catch {
                            self.error = error.localizedDescription
                            lastRunLabel = "Inference failed • \(error.localizedDescription)"
                        }
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(busy || prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                Text(lastRunLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading)

                ScrollView {
                    Text(output.isEmpty ? "Ready." : output)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .textSelection(.enabled)
                }
                Spacer(minLength: 0)
            }
            .padding()
            .navigationTitle("Apex")
            .onAppear { refreshInventory() }
            .fileImporter(
                isPresented: $modelImportPresented,
                allowedContentTypes: [ggufType],
                allowsMultipleSelection: false
            ) { result in
                do {
                    guard let sourceURL = try result.get().first else { return }
                    let didStartAccessing = sourceURL.startAccessingSecurityScopedResource()
                    defer {
                        if didStartAccessing { sourceURL.stopAccessingSecurityScopedResource() }
                    }

                    let values = try sourceURL.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey])
                    guard values.isRegularFile == true, let rawSize = values.fileSize, rawSize > 0 else {
                        throw ApexModelCatalogError.unreadableHeader
                    }
                    try ApexModelCatalog.validateImport(source: sourceURL, sizeBytes: Int64(rawSize))

                    let documents = ApexModelCatalog.directory
                    let destination = uniqueDestination(in: documents, fileName: sourceURL.lastPathComponent)
                    try FileManager.default.copyItem(at: sourceURL, to: destination)
                    selectedModelID = destination.lastPathComponent
                    modelStatus = "Imported \(destination.lastPathComponent). Original source preserved; import is a copy."
                    refreshInventory()
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

    private func refreshInventory() {
        models = ApexModelCatalog.inventory()
        if let selectedModelID, models.contains(where: { $0.id == selectedModelID }) {
            return
        }
        selectedModelID = models.first?.id
    }

    private func uniqueDestination(in directory: URL, fileName: String) -> URL {
        let candidate = directory.appendingPathComponent(fileName)
        guard FileManager.default.fileExists(atPath: candidate.path) else { return candidate }
        let name = candidate.deletingPathExtension().lastPathComponent
        let ext = candidate.pathExtension
        return directory.appendingPathComponent("\(name)-\(UUID().uuidString).\(ext)")
    }
}
