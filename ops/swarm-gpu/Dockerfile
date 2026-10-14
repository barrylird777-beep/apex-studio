FROM vllm/vllm-openai:v0.10.2

# Plugin code is shipped in the image, not injected from a persistent model volume.
COPY apex_peer_cas.py /opt/apex/apex_peer_cas.py
COPY sitecustomize.py /opt/apex/sitecustomize.py
COPY apex_transformers_memory.py /opt/apex/apex_transformers_memory.py
ENV PYTHONPATH="/opt/apex"
ENV HF_HUB_OFFLINE="1" \
    HF_DATASETS_OFFLINE="1" \
    TRANSFORMERS_OFFLINE="1" \
    HF_HUB_DISABLE_TELEMETRY="1" \
    APEX_REQUIRE_VLLM_PLUGIN="1"

# Fail closed if the plugin cannot be imported/registered. This is a build-time
# import check only; it does not claim a live Peer-CAS connection or GPU startup.
RUN python -c "import apex_peer_cas; from vllm.model_executor.model_loader import get_model_loader; from vllm.config.load import LoadConfig; get_model_loader(LoadConfig(load_format='apex_peer_cas')); import apex_transformers_memory; apex_transformers_memory.install()"
