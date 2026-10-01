# Apex Studio — Private-First Architecture

Apex is designed to minimize unnecessary third-party data exposure while remaining compatible with lawful deployment and external services when explicitly enabled.

## Defaults
- Local-first operation.
- Remote providers disabled by default.
- Telemetry disabled by default.
- Remote sync disabled by default.
- Crash reporting disabled by default.
- Secrets are never included in exports.
- Provider adapters remain optional boundaries.

## Deployment direction
1. Run Apex on hardware you control.
2. Keep project state, source ingestion, embeddings, assets, and logs local.
3. Use local/open-weight model adapters where practical.
4. Encrypt persistent storage and backups at the deployment layer.
5. Expose the network API only when needed, preferably behind authentication and TLS.
6. Enable remote providers individually rather than globally.

## Important boundary
Privacy engineering reduces unnecessary collection and exposure; it does not make a system invisible or exempt from the laws, policies, or access rules applicable to the hardware, network, or jurisdiction where it operates.

## Roadmap
- encrypted persistent store
- local model runtime adapters
- authentication and role-based permissions
- signed project bundles
- offline export/import
- local vector database adapter
- configurable network egress policy
- local audit trail
- backup/restore tooling
