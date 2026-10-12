# Apex GPU Swarm

Self-hosted open-weight coding swarm for Apex. The swarm targets an OpenAI-compatible vLLM endpoint and keeps model execution separate from repository promotion.

Architecture:
- six surface workers run concurrently
- each worker receives a bounded task manifest
- model output is structured as file operations
- files are written to isolated staging workspaces
- validation runs before promotion
- successful work is committed atomically
- failed deterministic tasks stop retrying
- transient failures use exponential backoff with jitter

The runner requires only Node.js 22+ and an OpenAI-compatible endpoint.

Environment:
SWARM_BASE_URL=http://127.0.0.1:8000/v1
SWARM_API_KEY=local
SWARM_MODEL=<served-model>
SWARM_ROOT=/srv/apex/se-x/projects/swarm
SWARM_REPO=/srv/apex/se-x/projects/apex-studio
SWARM_CONCURRENCY=6
SWARM_MAX_RETRIES=4

Do not put provider credentials in repository files.
