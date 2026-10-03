# Security boundaries

Secrets are environment-only and must never be committed.
Source contact information is encrypted with Fernet before persistence.
JWT access is role-based: researcher, editor, admin.
Sensitive-network restrictions are configurable through ALLOWED_SENSITIVE_CIDRS.
AIR_GAPPED_MODE disables outbound public-record connectors.
Audit logs are append-only at the database layer.
Documents use SHA-256 hashes for chain-of-custody verification.
Production deployments must configure encrypted backups and jurisdiction-specific retention before storing sensitive material.
