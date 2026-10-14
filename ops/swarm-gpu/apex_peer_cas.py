"""Strict Peer-CAS bridge client and vLLM 0.10.2 custom weight loader.

The bridge must expose authenticated, namespace-scoped manifest/file endpoints.
No Hugging Face or local model-file fallback is permitted.
"""
from __future__ import annotations
import hashlib
import json
import os
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen\nfrom urllib.parse import quote, urlencode

NAMESPACE = os.environ.get("APEX_PEER_CAS_NAMESPACE", "")
MODEL_ID = os.environ.get("APEX_MODEL_ID", "")
REVISION = os.environ.get("APEX_MODEL_REVISION", "")
BRIDGE = os.environ.get("APEX_PEER_CAS_BRIDGE", "").rstrip("/")
TOKEN = os.environ.get("APEX_PEER_CAS_TOKEN", "")

def _require_env():
    if not all((NAMESPACE, MODEL_ID, REVISION, BRIDGE, TOKEN)):
        raise RuntimeError("APEX Peer-CAS bridge, token, namespace, model ID and revision are required")
    if not BRIDGE.startswith("https://") and not BRIDGE.startswith("http://127.0.0.1:"):
        raise RuntimeError("Peer-CAS bridge must use HTTPS or loopback HTTP")

def _get(path: str) -> bytes:
    _require_env()
    req = Request(BRIDGE + path, headers={"Authorization": "Bearer " + TOKEN,
                                          "Accept": "application/octet-stream"})
    try:
        with urlopen(req, timeout=60) as response:
            if response.status != 200:
                raise RuntimeError("Peer-CAS bridge returned non-200")
            chunks = bytearray()\n            while True:\n                chunk = response.read(32 * 1024)\n                if not chunk:\n                    break\n                chunks.extend(chunk)\n            return bytes(chunks)
    except (HTTPError, URLError) as exc:
        raise RuntimeError("Peer-CAS retrieval failed closed") from exc

def manifest() -> dict:
    raw = _get("/v1/peer-cas/models/" + quote(MODEL_ID, safe="") + "/" + quote(REVISION, safe="") + "/manifest")
    value = json.loads(raw)
    if value.get("namespace") != NAMESPACE or value.get("model_id") != MODEL_ID or value.get("revision") != REVISION:
        raise RuntimeError("Peer-CAS manifest identity or namespace mismatch")
    files = value.get("files")
    if not isinstance(files, list) or not files:
        raise RuntimeError("Peer-CAS model manifest has no files")
    seen = set()
    for item in files:
        path, sha, size = item.get("path"), item.get("sha256"), item.get("size")
        if (not isinstance(path, str) or path.startswith("/") or "\x00" in path
                or any(part in ("", ".", "..") for part in path.split("/"))
                or path in seen or not isinstance(sha, str)
                or len(sha) != 64 or any(c not in "0123456789abcdef" for c in sha)
                or not isinstance(size, int) or size < 0):
            raise RuntimeError("Invalid Peer-CAS file descriptor")
        seen.add(path)
    return value

def file_bytes(item: dict) -> bytes:
    query = urlencode({"model_id": MODEL_ID, "revision": REVISION})\n    data = _get("/v1/peer-cas/blobs/" + item["sha256"] + "?" + query)
    if len(data) != item["size"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
        raise RuntimeError("Peer-CAS file integrity check failed")
    return data

def model_files() -> dict[str, bytes]:
    value = manifest()
    files = {item["path"]: file_bytes(item) for item in value["files"]}
    if "config.json" not in files or not any(k.endswith(".safetensors") for k in files):
        raise RuntimeError("Model bundle must include config.json and Safetensors weight shards")
    if not any(k in files for k in ("tokenizer.json", "tokenizer.model")):
        raise RuntimeError("Model bundle lacks a supported tokenizer asset")
    return files

# The vLLM 0.10.2 loader registry is process-local; this module must be imported
# before vLLM constructs its model loader.
try:
    from vllm.config import ModelConfig
    from vllm.config.load import LoadConfig
    from vllm.model_executor.model_loader import register_model_loader
    from vllm.model_executor.model_loader.base_loader import BaseModelLoader
    from safetensors.torch import load as safetensors_load
    import torch.nn as nn

    @register_model_loader("apex_peer_cas")
    class ApexPeerCASModelLoader(BaseModelLoader):
        def __init__(self, load_config: LoadConfig):
            super().__init__(load_config)
            self._files = None

        def download_model(self, model_config: ModelConfig) -> None:
            self._files = model_files()

        def load_weights(self, model: nn.Module, model_config: ModelConfig) -> None:
            files = self._files or model_files()
            def tensors():
                for name in sorted(k for k in files if k.endswith(".safetensors")):
                    state = safetensors_load(files[name])
                    for key, tensor in state.items():
                        yield key, tensor
            model.load_weights(tensors())
except ImportError as exc:
    # Importing this module outside the pinned vLLM image is supported for
    # static tooling, but engine startup must fail if registration is unavailable.
    if os.environ.get("APEX_REQUIRE_VLLM_PLUGIN") == "1":
        raise RuntimeError("Could not register apex_peer_cas with pinned vLLM") from exc
