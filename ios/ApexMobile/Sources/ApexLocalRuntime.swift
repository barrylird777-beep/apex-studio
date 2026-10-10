import Foundation
import llama

actor ApexLocalRuntime {
    static let shared = ApexLocalRuntime()

    private var model: OpaquePointer?
    private var context: OpaquePointer?
    private var vocab: OpaquePointer?
    private var sampler: UnsafeMutablePointer<llama_sampler>?
    private var batch: llama_batch?
    private var position: Int32 = 0

    private let contextSize: UInt32 = 2048
    private let outputLimit: Int32 = 512

    func loadInstalledModel() throws {
        if model != nil { return }

        let directory = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let models = try FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: nil
        ).filter { $0.pathExtension.lowercased() == "gguf" }

        guard let url = models.first else { throw ApexLocalError.noModel }
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

        var contextParams = llama_context_default_params()
        contextParams.n_ctx = contextSize
        contextParams.n_batch = 512

        let threads = max(2, min(8, ProcessInfo.processInfo.processorCount - 2))
        contextParams.n_threads = Int32(threads)
        contextParams.n_threads_batch = Int32(threads)

        guard let createdContext = llama_init_from_model(loaded, contextParams) else {
            llama_model_free(loaded)
            model = nil
            throw ApexLocalError.contextFailed
        }

        context = createdContext

        let samplerParams = llama_sampler_chain_default_params()
        guard let createdSampler = llama_sampler_chain_init(samplerParams) else {
            throw ApexLocalError.contextFailed
        }

        sampler = createdSampler
        llama_sampler_chain_add(createdSampler, llama_sampler_init_temp(0.7))
        llama_sampler_chain_add(createdSampler, llama_sampler_init_dist(42))

        batch = llama_batch_init(512, 0, 1)
        position = 0
    }

    func generate(_ prompt: String) throws -> String {
        if model == nil {
            try loadInstalledModel()
        }

        guard let context, let vocab, let sampler, var batch else {
            throw ApexLocalError.loadFailed
        }

        let tokens = try tokenize(prompt, vocab: vocab)
        guard !tokens.isEmpty else { return "" }

        batch.n_tokens = 0

        for (index, token) in tokens.enumerated() {
            add(
                &batch,
                token: token,
                position: Int32(index),
                logits: index == tokens.count - 1
            )
        }

        guard llama_decode(context, batch) == 0 else {
            throw ApexLocalError.contextFailed
        }

        position = Int32(tokens.count)

        var output = ""

        for _ in 0..<outputLimit {
            let token = llama_sampler_sample(sampler, context, batch.n_tokens - 1)

            if llama_vocab_is_eog(vocab, token) {
                break
            }

            output += piece(token, vocab: vocab)

            batch.n_tokens = 0
            add(&batch, token: token, position: position, logits: true)
            position += 1

            if llama_decode(context, batch) != 0 {
                break
            }
        }

        return output
    }

    func unload() {
        if let sampler {
            llama_sampler_free(sampler)
            self.sampler = nil
        }

        if var batch {
            llama_batch_free(batch)
            self.batch = nil
        }

        if let context {
            llama_free(context)
            self.context = nil
        }

        if let model {
            llama_model_free(model)
            self.model = nil
        }

        vocab = nil
        position = 0
        llama_backend_free()
    }

    private func tokenize(_ text: String, vocab: OpaquePointer) throws -> [llama_token] {
        let utf8 = Array(text.utf8)
        let needed = utf8.withUnsafeBufferPointer { bytes -> Int32 in
            llama_tokenize(
                vocab,
                text,
                Int32(bytes.count),
                nil,
                0,
                true,
                true
            )
        }

        let required = Int(-needed)
        guard required > 0 else { return [] }

        let pointer = UnsafeMutablePointer<llama_token>.allocate(capacity: required)
        defer { pointer.deallocate() }

        let count = llama_tokenize(
            vocab,
            text,
            Int32(utf8.count),
            pointer,
            Int32(required),
            true,
            true
        )

        guard count >= 0 else { throw ApexLocalError.tokenizeFailed }

        return (0..<Int(count)).map { pointer[$0] }
    }

    private func add(
        _ batch: inout llama_batch,
        token: llama_token,
        position: Int32,
        logits: Bool
    ) {
        let index = Int(batch.n_tokens)
        batch.token[index] = token
        batch.pos[index] = position
        batch.n_seq_id[index] = 1
        batch.seq_id[index]![0] = 0
        batch.logits[index] = logits ? 1 : 0
        batch.n_tokens += 1
    }

    private func piece(_ token: llama_token, vocab: OpaquePointer) -> String {
        var buffer = [CChar](repeating: 0, count: 256)
        let count = llama_token_to_piece(
            vocab,
            token,
            &buffer,
            Int32(buffer.count),
            0,
            false
        )

        guard count > 0 else { return "" }

        return String(
            bytes: buffer.prefix(Int(count)).map { UInt8(bitPattern: $0) },
            encoding: .utf8
        ) ?? ""
    }
}

enum ApexLocalError: LocalizedError {
    case noModel
    case loadFailed
    case contextFailed
    case tokenizeFailed

    var errorDescription: String? {
        switch self {
        case .noModel:
            "No GGUF model is installed in Apex Mobile."
        case .loadFailed:
            "The local model could not be loaded."
        case .contextFailed:
            "The local inference context failed."
        case .tokenizeFailed:
            "The local model could not tokenize the request."
        }
    }
}
