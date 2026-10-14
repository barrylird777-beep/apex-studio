# APEX Peer-CAS loader integration

## Implemented components
- vLLM image pinned to 0.10.2, with custom loader registration and Transformers adapters installed at interpreter startup.
- Config is constructed from the Peer-CAS `config.json` bytes using `AutoConfig.for_model`; tokenizer is constructed from the Peer-CAS `tokenizer.json` bytes without a model directory.
- Weight shards are requested one at a time over a Unix-domain HTTP socket, received in 32 KiB reads, SHA-256/length checked, then deserialized from bytes. No model cache or local model directory is a source of truth.
- `src/core/peer-model-bundle.mjs` stores each asset through the existing app-scoped Peer-CAS and atomically references the complete bundle.
- `src/core/peer-model-bridge.mjs` exposes an authenticated HTTP protocol over a private Unix-domain socket at `/tmp/apex_peer_cas.sock`. `ops/swarm-gpu/peer-cas-bridge-runner.mjs` starts it when given a runtime module exporting `getPeerModelBridgeContext()`.
- Hugging Face Hub, datasets, and Transformers offline flags are forced; vLLM usage stats, WandB telemetry, Ray usage stats, and pip index access are disabled by environment policy.
- The Dockerfile uses a verification stage and a separate runtime stage. The runtime stage removes apt/pip/npm command entry points and the Python pip module after the pinned vLLM runtime is present. This is a source-level change only until the image build and runtime smoke test pass.
- Compose selects vLLM's multiprocessing executor (`mp`) to avoid Ray for this single-host worker. This is not a multi-node distributed-executor solution; multi-node inference would require a separate verified design.
- The browser WebRTC proof no longer uses Google's public STUN endpoint. It is direct-candidate-only with manual copy/paste signaling. It does not yet implement sovereign DHT-backed signaling, and direct browser connectivity can fail behind NAT/firewalls without a controlled ICE/TURN strategy.

## Runtime configuration
The Python worker defaults to `APEX_PEER_CAS_BRIDGE=unix:///tmp/apex_peer_cas.sock` and requires `APEX_PEER_CAS_TOKEN`, `APEX_PEER_CAS_NAMESPACE`, `APEX_MODEL_ID`, and `APEX_MODEL_REVISION`. Compose bind-mounts the host socket path into the container; the socket must already exist before Compose starts. The Node bridge still requires `APEX_PEER_CAS_RUNTIME_MODULE` pointing to a module that returns the live app-scoped store and explicit `authorizeModel` function. Do not expose this bridge publicly.

The bridge only serves bundles already published under `model-bundle.v1/<modelId>/<revision>`. It does not proxy to Hugging Face or any other provider.

## Compatibility and proof limits
- Memory tokenizer construction currently requires `tokenizer.json`; SentencePiece-only bundles are rejected.
- `AutoConfig.for_model` requires the architecture's Transformers configuration class to be present in the pinned image. Remote-code architectures are not loaded.
- The Unix-domain socket transport is implemented, but the production daemon has not yet been wired to supply its live model store, authorization context, or one-time token lifecycle. The runner remains an integration point, not proof of a live daemon connection.
- No tests were executed in this session, and no live GPU initialization, two-peer model transfer, restart recovery, or full memory-only vLLM startup has been verified. Do not treat this branch as production-ready until CI and those end-to-end checks pass.
