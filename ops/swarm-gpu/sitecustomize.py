"""Install APEX fail-closed environment guards before vLLM imports."""
import os

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["HF_DATASETS_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["APEX_REQUIRE_VLLM_PLUGIN"] = "1"

# Do not monkey-patch AutoConfig/AutoTokenizer with incomplete BytesIO shims.
# vLLM 0.10.2 resolves those before its model loader runs; APEX must provide
# registered in-memory config/tokenizer adapters before claiming full memory-only
# initialization. Until that adapter is installed, startup must not silently fall
# back to Hugging Face or a model cache.
