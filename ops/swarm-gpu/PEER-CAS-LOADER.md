# APEX Peer-CAS loader integration

## Implemented components
- vLLM image pinned to 0.10.2, with custom loader registration and Transformers adapters installed at interpreter startup.
- Config is constructed from the Peer-CAS `config.json` bytes using `AutoConfig.for_model`; tokenizer is constructed from the Peer-CAS `tokenizer.json` bytes without a model directory.
- Weight shards are requested one at a time, received over 32 KiB HTTP socket reads, SHA-256/length checked, then deserialized from bytes. No model cache or local model directory is a source of truth.
- `src/core/peer-model-bundle.mjs` stores each asset through the existing app-scoped Peer-CAS and atomically references the complete bundle.
- `src/core/peer-model-bridge.mjs` exposes an authenticated loopback socket bridge to an injected live Peer-CAS store. `ops/swarm-gpu/peer-cas-bridge-runner.mjs` starts it when given a runtime module exporting `getPeerModelBridgeContext()`.
- Hugging Face Hub, datasets, and Transformers offline flags are forced; unknown model IDs fail closed.

## Runtime configuration
The Python worker requires `APEX_PEER_CAS_BRIDGE=http://127.0.0.1:8765`, `APEX_PEER_CAS_TOKEN`, `APEX_PEER_CAS_NAMESPACE`, `APEX_MODEL_ID`, and `APEX_MODEL_REVISION`. The Node bridge requires `APEX_PEER_CAS_RUNTIME_MODULE` pointing to a module that returns the live app-scoped store and explicit `authorizeModel` function. Keep the bridge bound to loopback and share a network namespace between the Node bridge and Python worker; do not expose the bearer-token bridge publicly.

The bridge only serves bundles already published under `model-bundle.v1/<modelId>/<revision>`. It does not proxy to Hugging Face or any other provider.

## Compatibility and proof limits
- Memory tokenizer construction currently requires `tokenizer.json`; SentencePiece-only bundles are rejected.
- `AutoConfig.for_model` requires the architecture's Transformers configuration class to be present in the pinned image. Remote-code architectures are not loaded.
- The Node bridge runner is an integration point, not an assertion that the production daemon has already injected its live transport/store. A runtime module must be supplied by that daemon.
- No tests were executed in this session, and no live GPU initialization, two-peer model transfer, restart recovery, or full memory-only vLLM startup has been verified. Do not treat this branch as production-ready until CI and those end-to-end checks pass.
