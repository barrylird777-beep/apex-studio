"""Fail-closed in-memory Transformers adapters for the pinned APEX vLLM image."""
import json
import threading

_lock = threading.RLock()
_cache = None
_installed = False

def _assets():
    """Fetch only tokenizer/config metadata; never preload weight shards."""
    global _cache
    with _lock:
        if _cache is None:
            from apex_peer_cas import manifest, file_bytes
            value = manifest()
            metadata = [item for item in value["files"]
                        if not item["path"].endswith(".safetensors")]
            _cache = {item["path"]: file_bytes(item) for item in metadata}
            if "config.json" not in _cache or "tokenizer.json" not in _cache:
                raise RuntimeError("Peer-CAS requires config.json and tokenizer.json for in-memory Transformers")
        return _cache

def install():
    """Patch the shared Transformers factories before vLLM creates EngineArgs."""
    global _installed
    with _lock:
        if _installed:
            return
        from transformers import AutoConfig, AutoTokenizer, PreTrainedTokenizerFast
        from tokenizers import Tokenizer

        original_config = AutoConfig.from_pretrained.__func__
        original_tokenizer = AutoTokenizer.from_pretrained.__func__

        def from_config(cls, pretrained_model_name_or_path, *args, **kwargs):
            from apex_peer_cas import MODEL_ID
            if str(pretrained_model_name_or_path) != MODEL_ID:
                raise RuntimeError("APEX offline mode denies non-Peer-CAS model configuration")
            files = _assets()
            raw = files.get("config.json")
            if raw is None:
                raise RuntimeError("Peer-CAS config.json missing")
            config_data = json.loads(raw)
            model_type = config_data.get("model_type")
            if not isinstance(model_type, str) or not model_type:
                raise RuntimeError("config.json lacks model_type")
            config_data.pop("auto_map", None)
            config = AutoConfig.for_model(model_type, **{
                key: value for key, value in config_data.items() if key != "model_type"
            })
            for key, value in kwargs.items():
                if key in ("trust_remote_code", "local_files_only", "revision", "cache_dir",
                           "force_download", "token", "use_auth_token"):
                    continue
                if hasattr(config, key):
                    setattr(config, key, value)
            return config

        def from_tokenizer(cls, pretrained_model_name_or_path, *args, **kwargs):
            from apex_peer_cas import MODEL_ID
            if str(pretrained_model_name_or_path) != MODEL_ID:
                raise RuntimeError("APEX offline mode denies non-Peer-CAS tokenizer resolution")
            files = _assets()
            raw = files.get("tokenizer.json")
            if raw is None:
                raise RuntimeError("Peer-CAS tokenizer.json missing")
            tokenizer = Tokenizer.from_str(raw.decode("utf-8"))
            options = {}
            if "tokenizer_config.json" in files:
                options = json.loads(files["tokenizer_config.json"])
            allowed = {"model_max_length", "padding_side", "truncation_side",
                       "clean_up_tokenization_spaces", "split_special_tokens"}
            init = {k: options[k] for k in allowed if k in options}
            init["tokenizer_object"] = tokenizer
            if "special_tokens_map.json" in files:
                special = json.loads(files["special_tokens_map.json"])
                init.update({k: v for k, v in special.items()
                             if k in {"bos_token", "eos_token", "unk_token", "sep_token",
                                      "pad_token", "cls_token", "mask_token", "additional_special_tokens"}})
            result = PreTrainedTokenizerFast(**init)
            if "chat_template" in options:
                result.chat_template = options["chat_template"]
            return result

        AutoConfig.from_pretrained = classmethod(from_config)
        AutoTokenizer.from_pretrained = classmethod(from_tokenizer)
        _installed = True
