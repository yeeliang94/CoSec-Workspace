# Coordinated backup and recovery

The local milestone uses MySQL plus private attachment bytes in `STORAGE_DIR` (default `.local/storage`). Neither a database dump nor a folder copy is sufficient alone. Do not back up a running writable instance by independently copying these sources.

## Consistent local backup

1. Stop the Next.js app and reminder worker; prevent other writers. Keep MySQL running. Record the app commit/dependency lockfile and migration version.
2. Use the MySQL client tools matching the installed server. Run `mysqldump --single-transaction --routines --triggers --hex-blob --databases cosec` with credentials supplied through a protected MySQL option file or interactive prompt, and write the dump into a new timestamped backup directory. Never place a password in shell history.
3. Copy the entire private storage directory into the same backup directory. Include protected deployment configuration separately: database connection, Better Auth secret/base URL and storage path. Do not copy the working MySQL data directory as an ad-hoc substitute for a dump.
4. Create a manifest of relative filenames, sizes and SHA-256 hashes for dump, attachments and configuration. Restrict directory access to the responsible operator and encrypt any removable/off-machine copy. Preserve more than one generation.
5. Restart the app and worker. Check an authorised workspace and download. Record backup completion and failures in the firm's operational log. Backups are complete only after both database and attachments are present and verified.

## Restore rehearsal

1. Stop the app and worker. Restore into an isolated, empty database and a new storage directory first; preserve the existing environment for rollback.
2. Import the dump using the MySQL client. Restore the matching attachment directory and protected configuration. Confirm schema migrations match the recorded app version; do not blindly run a destructive reset or seed script.
3. Verify all document metadata references resolve under the restored storage root, their sizes and SHA-256 hashes match, and no public directory serves attachments. Missing/tampered documents must remain errors, not successful downloads.
4. Sign in as executive, reviewer and lodger; verify company-scoped reads/downloads, pack/review history, dated officer history, submission/outcome separation, correspondence and audit. Check one historical annual snapshot remains unchanged.
5. Start the reminder worker or load the work queue. Overdue reminders are regenerated from persisted dates; reading a reminder does not resolve work. Confirm no duplicate occurrences after a second reconciliation.
6. Only switch local configuration to the restored database/storage pair when the rehearsal passes. Record operator/time, source backup, verification and rollback location. Rotate/revoke sessions and credentials if compromise, rather than equipment failure, triggered recovery.

No retention/hold/disposal policy is approved by this document. Obtain the firm's approved destination, encryption, schedule, retention and recovery-time/recovery-point requirements before live use. This procedure has not itself been a completed recovery rehearsal until acceptance evidence records one.

## File handling limits

The first milestone accepts immutable PDF, PNG, JPEG and UTF-8 plain text evidence, at most 15 MiB per file. It checks declared extension, MIME and magic bytes, stores generated opaque filenames outside `public`, and verifies SHA-256 on download. It does not include anti-malware scanning or prove that a scan is signed or an original is in custody. Complex Office containers and live-client imports remain deferred until file policy/scanning and original template formats are confirmed. Downloads must use `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.
