# APEX Peer-CAS loader integration

## Implemented baseline
- vLLM image is pinned to 0.10.2.
- The custom `apex_peer_cas` loader registers through vLLM's custom loader registry.
- Safetensors shards are deserialized from verified bytes using `safetensors.torch.load`.
- Namespace/model/revision identity, path traversal, file size, SHA-256, and required bundle assets are checked.
- Hugging Face Hub, datasets, and Transformers offline modes are forced before vLLM starts.
- No model cache volume or local model directory is used as a storage source.

## Required bridge contract
The worker requires an authenticated APEX-owned Peer-CAS bridge:
- `GET /v1/peer-cas/models/{model_id}/{revision}/manifest` returns a manifest with `namespace`, `model_id`, `revision`, and `files: [{path, sha256, size}]`.
- `GET /v1/peer-cas/blobs/{sha256}` returns the raw bytes for that content hash.
- Both endpoints must enforce the bearer credential, app namespace, model authorization, and peer-CAS retrieval. The bridge must not proxy to Hugging Face or any other provider.
- Manifest data is a transport response only; Peer-CAS remains the authoritative store.

Required environment: `APEX_PEER_CAS_BRIDGE`, `APEX_PEER_CAS_TOKEN`, `APEX_PEER_CAS_NAMESPACE`, `APEX_MODEL_ID`, and `APEX_MODEL_REVISION`.

## Important remaining gate
vLLM 0.10.2 resolves model configuration and tokenizer before the custom weight loader is invoked. This commit deliberately does **not** pretend that a weight-loader hook intercepts those earlier stages. Complete memory-only startup requires a tested vLLM entrypoint/config/tokenizer integration for the pinned version, including tokenizer assets and any architecture-specific files. The Docker build check validates registration only; it is not a live GPU or peer-mesh proof.
