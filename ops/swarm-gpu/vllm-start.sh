#!/usr/bin/env bash
set -euo pipefail
: "${MODEL:?MODEL is required}"
: "${VLLM_PORT:=8000}"
: "${GPU_MEMORY_UTILIZATION:=0.92}"
: "${MAX_MODEL_LEN:=32768}"
exec vllm serve "$MODEL" --host 0.0.0.0 --port "$VLLM_PORT" --gpu-memory-utilization "$GPU_MEMORY_UTILIZATION" --max-model-len "$MAX_MODEL_LEN" --enable-prefix-caching
