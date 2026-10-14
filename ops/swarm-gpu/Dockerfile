FROM vllm/vllm-openai:v0.10.2 AS verify

COPY apex_peer_cas.py /opt/apex/apex_peer_cas.py
COPY sitecustomize.py /opt/apex/sitecustomize.py
COPY apex_transformers_memory.py /opt/apex/apex_transformers_memory.py

ENV PYTHONPATH="/opt/apex" \
    HF_HUB_OFFLINE="1" \
    HF_DATASETS_OFFLINE="1" \
    TRANSFORMERS_OFFLINE="1" \
    HF_HUB_DISABLE_TELEMETRY="1" \
    VLLM_NO_USAGE_STATS="1" \
    DO_NOT_TRACK="1" \
    WANDB_DISABLED="true" \
    RAY_USAGE_STATS_ENABLED="0" \
    PIP_NO_INDEX="1" \
    PIP_DISABLE_PIP_VERSION_CHECK="1" \
    TOKENIZERS_PARALLELISM="false" \
    PYTHONDONTWRITEBYTECODE="1" \
    APEX_REQUIRE_VLLM_PLUGIN="1"

# Validate custom-loader registration against the pinned vLLM runtime before
# copying only the required plugin source into the final stage.
RUN python -c "import apex_peer_cas; from vllm.model_executor.model_loader import get_model_loader; from vllm.config.load import LoadConfig; get_model_loader(LoadConfig(load_format='apex_peer_cas')); import apex_transformers_memory; apex_transformers_memory.install()"

FROM vllm/vllm-openai:v0.10.2 AS runtime

COPY --from=verify /opt/apex/apex_peer_cas.py /opt/apex/apex_peer_cas.py
COPY --from=verify /opt/apex/sitecustomize.py /opt/apex/sitecustomize.py
COPY --from=verify /opt/apex/apex_transformers_memory.py /opt/apex/apex_transformers_memory.py

ENV PYTHONPATH="/opt/apex" \
    HF_HUB_OFFLINE="1" \
    HF_DATASETS_OFFLINE="1" \
    TRANSFORMERS_OFFLINE="1" \
    HF_HUB_DISABLE_TELEMETRY="1" \
    VLLM_NO_USAGE_STATS="1" \
    DO_NOT_TRACK="1" \
    WANDB_DISABLED="true" \
    RAY_USAGE_STATS_ENABLED="0" \
    PIP_NO_INDEX="1" \
    PIP_DISABLE_PIP_VERSION_CHECK="1" \
    TOKENIZERS_PARALLELISM="false" \
    PYTHONDONTWRITEBYTECODE="1" \
    APEX_REQUIRE_VLLM_PLUGIN="1"

# Remove package-manager entry points and Python pip module from the runtime
# image. This does not remove vLLM's already-installed execution dependencies.
RUN python -c "import pathlib, shutil, importlib.util; paths=['/usr/bin/apt','/usr/bin/apt-get','/usr/bin/apt-cache','/usr/bin/apt-mark','/usr/local/bin/pip','/usr/local/bin/pip3','/usr/bin/pip','/usr/bin/pip3','/usr/local/bin/npm','/usr/bin/npm','/usr/local/bin/npx','/usr/bin/npx']; [pathlib.Path(p).unlink(missing_ok=True) for p in paths]; spec=importlib.util.find_spec('pip'); shutil.rmtree(spec.submodule_search_locations[0], ignore_errors=True) if spec and spec.submodule_search_locations else None"

# Re-check loader registration after package-manager removal.
RUN python -c "import apex_peer_cas; from vllm.model_executor.model_loader import get_model_loader; from vllm.config.load import LoadConfig; get_model_loader(LoadConfig(load_format='apex_peer_cas')); import apex_transformers_memory; apex_transformers_memory.install()"
RUN python -c "import importlib.util, pathlib, shutil; assert importlib.util.find_spec('pip') is None, 'pip module remains in runtime image'; assert all(shutil.which(x) is None for x in ('apt','apt-get','pip','pip3','npm','npx')), 'package manager executable remains in PATH'"
