import Foundation
import llama

/// Device-local inference runtime. Model files remain inside the app container.
/// llama.cpp uses Metal when its XCFramework is built with Metal enabled.
actor ApexLocalRuntime {
    static let shared = ApexLocalRuntime()

    private var model: OpaquePointer?
    private var context: OpaquePointer?
    private var vocab: OpaquePointer?
    private var sampler: UnsafeMutablePointer<llama_sampler>?
    private var batch: llama_batch?\n    /// Bridge-owned token cursor. Every fresh inference begins at position zero.\n    private var tokenPosition: Int32 = 0

    private let contextSize: UInt32 = 4096
    private let batchSize: Int32 = 512
    private let outputLimit: Int32 = 1024

    func installedModels() -> [URL] {
        let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        return (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension.lowercased() == "gguf" }
            .sorted { $0.lastPathComponent.localizedCaseInsensitiveCompare($1.lastPathComponent) == .orderedAscending }) ?? []
    }

    func installModel(from url: URL) throws {
        let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let destination = directory.appendingPathComponent(url.lastPathComponent)
        if destination.standardizedFileURL != url.standardizedFileURL {
            if FileManager.default.fileExists(atPath: destination.path) { try FileManager.default.removeItem(at: destination) }
            try FileManager.default.copyItem(at: url, to: destination)
        }
        unload()
    }

    func loadInstalledModel() throws {
        if model != nil { return }
        guard let url = installedModels().first else { throw ApexLocalError.noModel }
        try load(path: url.path)
    }

    func load(path: String) throws {
        unload()
        llama_backend_init()

        var params = llama_model_default_params()
        params.n_gpu_layers = 99

        guard let loaded = llama_model_load_from_file(path, params) else {
            throw ApexLocalError.loadFailed
        }
        model = loaded
        vocab = llama_model_get_vocab(loaded)
        try createExecutionContext()
    }

    private func createExecutionContext() throws {
        guard let model else { throw ApexLocalError.loadFailed }

        var contextParams = llama_context_default_params()
        contextParams.n_ctx = contextSize
        contextParams.n_batch = UInt32(batchSize)
        let threads = max(2, min(8, ProcessInfo.processInfo.processorCount - 2))
        contextParams.n_threads = Int32(threads)
        contextParams.n_threads_batch = Int32(threads)

        guard let created = llama_init_from_model(model, contextParams) else {
            throw ApexLocalError.contextFailed
        }
        context = created

        let samplerParams = llama_sampler_chain_default_params()
        guard let createdSampler = llama_sampler_chain_init(samplerParams) else {
            llama_free(created)
            context = nil
            throw ApexLocalError.contextFailed
        }
        sampler = createdSampler
        llama_sampler_chain_add(createdSampler, llama_sampler_init_temp(0.7))
        llama_sampler_chain_add(createdSampler, llama_sampler_init_dist(42))
        batch = llama_batch_init(batchSize, 0, 1)
    }

    private func resetExecutionContext() throws {
        if let sampler { llama_sampler_free(sampler); self.sampler = nil }
        if var batch { llama_batch_free(batch); self.batch = nil }
        if let context { llama_free(context); self.context = nil }
        try createExecutionContext()
    }

    func generate(_ prompt: String) throws -> String {
        if model == nil { try loadInstalledModel() }
        try resetExecutionContext()

        guard let context, let vocab, let sampler, var batch else {
            throw ApexLocalError.loadFailed
        }

        let tokens = try tokenize(prompt, vocab: vocab)
        guard !tokens.isEmpty else { return "" }
        guard tokens.count < Int(contextSize) - Int(outputLimit) else { throw ApexLocalError.contextTooSmall }

        // Context/token indices are deliberately reinitialized from zero after
        // the KV reset. Never inherit n_past or positions from an earlier request.
        llama_batch_clear(&batch)
        for (index, token) in tokens.enumerated() {
            add(&batch, token: token, position: Int32(index), logits: index == tokens.count - 1)
        }

        guard llama_decode(context, batch) == 0 else { throw ApexLocalError.contextFailed }

        tokenPosition = Int32(tokens.count)\n        var position = tokenPosition
        var output = ""

        for _ in 0..<outputLimit {
            let token = llama_sampler_sample(sampler, context, batch.n_tokens - 1)
            if llama_vocab_is_eog(vocab, token) { break }

            output += piece(token, vocab: vocab)
            llama_batch_clear(&batch)
            add(&batch, token: token, position: position, logits: true)
            position += 1
            if llama_decode(context, batch) != 0 { break }
        }
        return output
    }

    func unload() {
        if let sampler { llama_sampler_free(sampler); self.sampler = nil }
        if var batch { llama_batch_free(batch); self.batch = nil }
        if let context { llama_free(context); self.context = nil }
        if let model { llama_model_free(model); self.model = nil }
        vocab = nil
        llama_backend_free()
    }

    private func tokenize(_ text: String, vocab: OpaquePointer) throws -> [llama_token] {
        let utf8 = Array(text.utf8)
        let needed = llama_tokenize(vocab, text, Int32(utf8.count), nil, 0, true, true)
        let required = Int(-needed)
        guard required > 0 else { return [] }

        let pointer = UnsafeMutablePointer<llama_token>.allocate(capacity: required)
        defer { pointer.deallocate() }

        let count = llama_tokenize(vocab, text, Int32(utf8.count), pointer, Int32(required), true, true)
        guard count >= 0 else { throw ApexLocalError.tokenizeFailed }
        return (0..<Int(count)).map { pointer[$0] }
    }

    private func add(_ batch: inout llama_batch, token: llama_token, position: Int32, logits: Bool) {
        let index = Int(batch.n_tokens)
        batch.token[index] = token
        batch.pos[index] = position
        batch.n_seq_id[index] = 1
        batch.seq_id[index]![0] = 0
        batch.logits[index] = logits ? 1 : 0
        batch.n_tokens += 1
    }

    private func piece(_ token: llama_token, vocab: OpaquePointer) -> String {
        var buffer = [CChar](repeating: 0, count: 1024)
        let count = llama_token_to_piece(vocab, token, &buffer, Int32(buffer.count), 0, false)
        guard count > 0 else { return "" }
        return String(bytes: buffer.prefix(Int(count)).map { UInt8(bitPattern: $0) }, encoding: .utf8) ?? ""
    }
}

enum ApexLocalError: LocalizedError {
    case noModel, loadFailed, contextFailed, tokenizeFailed, contextTooSmall

    var errorDescription: String? {
        switch self {
        case .noModel: return "No GGUF model is installed in Apex Mobile."
        case .loadFailed: return "The local model could not be loaded."
        case .contextFailed: return "The local inference context failed."
        case .tokenizeFailed: return "The local model could not tokenize the request."
        case .contextTooSmall: return "The request is too large for the configured local context."
        }
    }
}
