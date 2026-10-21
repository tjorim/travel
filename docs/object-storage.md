# Object storage contract

Trip media, documents, derivatives, tracks and owner-library files are stored
as objects in `TRAVEL_MEDIA_STORAGE_ROOT` (`app/storage.py`), with one
`stored_objects` or `owner_stored_objects` row each. In production the root is
the private `travel_media` volume, and the apps backup captures it together
with the database while `travel-api` and `travel-media-dispatcher` keep running
(tjorim/apps#245). That backup is only consistent because every writer keeps
the rules below. Treat them as an interface: a change that breaks one can
produce backups whose database and files disagree, and nothing fails until a
restore.

## Rules

1. **Write before commit.** An object's bytes are written to a temporary file,
   fsynced and renamed into place before the row that names it commits
   (`LocalObjectStorage.put`).
2. **Never rewrite a referenced key with other bytes.** New objects get a fresh
   opaque key. Re-storing a `purge_pending` or `quarantined` row writes the
   same bytes (the row is matched by SHA-256). Worker output keys
   (`worker-<job>/…`) are rewritten only while no committed row names them.
3. **Delete only after `purge_pending` commits.** Bytes are removed only by
   `_purge_pending_objects` and `purge_owner_objects`, for a row already
   committed as `purge_pending`, under the row lock, and the row is deleted in
   the same transaction afterwards. Callers mark and commit first, then purge.
   The only other removal, the media worker's `discard_unrecorded_outputs`,
   deletes staged output that no row names.
4. **Hold the deletion lock while deleting.** Those purges take PostgreSQL
   advisory lock `OBJECT_DELETION_LOCK` (245, `lock_object_deletion`) before
   removing bytes. The apps backup holds the same key while it pins its
   database snapshot and hardlinks the volume, so no object the snapshot still
   references can disappear first. Do not renumber it without changing
   `scripts/backup-vps.sh` in tjorim/apps.
5. **No dot-entries.** Keys never start with a dot, at any level. The backup
   links the volume into `.backup-snapshot/` inside the root for a moment, and
   `LocalObjectStorage.objects()` skips dot-entries. Never list the root
   assuming it holds only objects.

A new feature that stores files must use `ObjectStorage` and an object row, or
add its own location to the apps backup.

## Unreferenced files

A crash between rule 1's write and the commit leaves a file no row names, and
a backup taken while Travel runs may also archive objects written after its
snapshot. The purge works from rows and never sees these files.

```bash
docker compose exec travel-api python -m app.maintenance reconcile-objects            # count only
docker compose exec travel-api python -m app.maintenance reconcile-objects --delete   # remove them
```

Only files older than `--older-than-hours` (default 24) are considered, so an
upload between its write and its commit is never touched; a row in any state
keeps its file. Output is a count, never keys. Run it after restoring the
volume from a backup.
