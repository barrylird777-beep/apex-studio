# Retired: PostgreSQL Backups

This document describes a legacy PostgreSQL backup workflow. It is **not** the current APEX storage design and must not be used as a setup or deployment instruction.

APEX's target is no PostgreSQL, no WAL, no local disk as the system of record, and no persisted JSON records. The current repository still contains legacy persistence and backup code, so do not infer that the target has been achieved. Before retiring any remaining PostgreSQL resources or deleting historical backups, establish whether they contain the only recoverable copy of user data and verify a tested migration.

No production database, volume, backup, or stored data was changed by this documentation update.
