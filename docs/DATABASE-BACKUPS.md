# PostgreSQL Backups\n\nApex Studio uses PostgreSQL as its durable persistence layer. The repository includes a local backup command that creates a PostgreSQL custom-format archive and a SHA-256 manifest.\n\n## Create a backup\n\nSet `DATABASE_URL` to the PostgreSQL connection URL and run:\n\n```bash\nnpm run db:backup\n```\n\nThe default destination is `./backups/postgres/`. Override it with `APEX_BACKUP_DIR`.\n\nThe backup command:\n- uses `pg_dump` custom format;\n- passes connection credentials through PostgreSQL environment variables instead of command-line arguments;\n- writes the archive with restrictive `0600` permissions;\n- writes a matching SHA-256 manifest;\n- removes an incomplete archive if `pg_dump` fails;\n- never writes backup artifacts into Git.\n\n`pg_dump` must be installed and available on `PATH`, or `PG_DUMP_BIN` can point to the executable.\n\n## Verify a backup archive\n\nA custom-format archive can be inspected without restoring it:\n\n```bash\npg_restore --list ./backups/postgres/apex-postgres-<timestamp>.dump\nsha256sum -c ./backups/postgres/apex-postgres-<timestamp>.dump.sha256\n```\n\nA successful `pg_restore --list` proves that the archive is structurally readable. It is not a substitute for a full restore test into a disposable PostgreSQL instance.\n\n## Railway recovery workflow\n\nRailway documents volume file browsing and downloads through its CLI. The current application control plane does not expose those volume-file operations, so recovery that needs direct volume access should use the Railway CLI.\n\n```bash\nrailway volume browse /\nrailway volume files download /path/to/backup ./backup\n```\n\nDo not delete, detach, reset, or replace the existing PostgreSQL volume during recovery.\n\nA raw copy of PostgreSQL's live data directory is not automatically a valid logical PostgreSQL backup. Prefer a completed `pg_dump` archive when PostgreSQL can accept connections. If the server is stuck in crash recovery, preserve the existing volume first and treat filesystem copies as forensic preservation, not as a verified PostgreSQL backup.\n\n## Current storage constraint\n\nRailway documents a 0.5 GB volume limit for Free and Trial plans. The backup command therefore writes to a configurable destination and does not assume that the database volume itself has spare capacity.\n\nBackups stored only on the same full PostgreSQL volume do not provide meaningful disaster protection. Transfer completed archives to a separate durable destination before relying on them for recovery.\n
## Stream a backup directly to Apex object storage

When PostgreSQL is healthy and `pg_dump` is available in the execution environment, a backup can be streamed directly to the configured S3-compatible object store without creating a local dump file:

```bash
APEX_BACKUP_OBJECT_BUCKET=apex-media-vault npm run db:backup:object-store
```

The command:
- streams PostgreSQL custom-format output directly from `pg_dump` into object storage;
- does not write the dump into the PostgreSQL volume;
- computes a SHA-256 digest while streaming;
- uploads a separate manifest only after the dump upload succeeds;
- uses the existing `APEX_OBJECT_STORE_ENDPOINT`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, and `AWS_SECRET_ACCESS_KEY` environment conventions;
- leaves multipart uploads disabled on error so a failed backup is not treated as valid.

Set `APEX_BACKUP_OBJECT_BUCKET` explicitly when the backup destination should differ from the normal media bucket. The existing Apex object-store bucket can be used if that is the intended durable destination.

This is an offsite logical backup, not a substitute for Railway volume/PITR recovery. The backup should eventually be restored into a disposable PostgreSQL instance as a recovery drill.
