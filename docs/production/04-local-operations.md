# Local Backup and Restore Operations

This procedure covers the current local SQLite development setup. It is not a production backup service and does not provide off-site recovery, retention scheduling, or high availability.

## Create a verified backup

Start CorridorAudit at least once so its SQLite database exists, then run:

```powershell
npm run db:backup
```

By default, the command reads `data/corridoraudit.db` and writes a uniquely named copy under `data/backups/`. It uses SQLite `VACUUM INTO`, runs `PRAGMA integrity_check` against the copy, applies owner-only file permissions where supported, and refuses to overwrite an existing destination. An unverified partial copy is removed.

Set `CORRIDOR_DB_PATH` to select another source database. Set `CORRIDOR_BACKUP_PATH` to choose the exact output path. The exact output path must not already exist.

Backup files are excluded from Git. Keep them on a protected local volume. Do not place them in a public or shared folder.

## Restore and verify

1. Copy a backup to a separate test path. Keep the original backup unchanged.
2. Set `CORRIDOR_DB_PATH` to the copy and start the local app in a controlled development environment.
3. Verify that cases, verdicts, raw records, integration settings, and pending review data can be read through the app. Check application logs for vault decryption errors.
4. Stop the app and record the restore result and the tested backup timestamp.

The automated test creates a backup while the source database is open with committed WAL data, checks SQLite integrity, opens the copy through the application database layer, and reads encrypted case and raw payload records. This validates a local code path, not a scheduled recovery exercise.

## Encryption key dependency

SQLite integrity verification does not prove that encrypted application fields can be decrypted. A restore must use the same vault key that encrypted the source database. Local development uses `data/.vault-key` unless `CORRIDOR_VAULT_KEY` is set. Keep the key in a separate protected backup or secret store. Never store the key beside an unprotected database backup or commit it to the repository.

In production, provide `CORRIDOR_VAULT_KEY` through managed secret storage. AWS KMS envelope encryption and key rotation are not implemented yet. A full restore exercise must prove recovery of both the database and its encryption key.

## Remaining local limits

- Backups run only when an operator invokes the command. No schedule, retention cleanup, off-site copy, alert, or restore-point objective is configured.
- This copies a single-host SQLite database. It does not protect against loss of the host or local storage.
- The long-term AWS recommendation remains RDS PostgreSQL automated backups, versioned private S3 evidence storage, KMS key management, and scheduled restore drills. See [Target Production Architecture](./02-target-architecture.md).
