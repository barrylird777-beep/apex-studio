"""Install APEX fail-closed environment guards and register its loader early."""
import os

os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["HF_DATASETS_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["APEX_REQUIRE_VLLM_PLUGIN"] = "1"

# Import at interpreter startup so the custom loader registry is populated before
# vLLM asks for the load format. This does not yet intercept earlier config/tokenizer
# resolution; that stage must be implemented and tested before serving models.
import apex_peer_cas  # noqa: F401,E402

import apex_transformers_memory
apex_transformers_memory.install()
