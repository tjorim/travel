# Remote video derivatives (#457)

Travel can hand its existing video derivative encoding to the private
[apps media worker](https://github.com/tjorim/apps/blob/cbb88ec9f19d1ea3e429ad9e1e7b8679239379ad/docs/media-worker.md).
This changes only encoding. Originals stay in Travel object storage; generated
video and poster return to Travel before they are reviewable. There is no new
capture/import source, permission, public endpoint or automatic approval.

## Configuration and dispatch

Apply `uv run alembic upgrade head` (revision `011_media_worker`). Every new
video derivative is remote: configure the API and dispatcher as shown in
[`backend/media-worker.env.example`](../backend/media-worker.env.example).
There is no in-process encoder or backend switch; with no worker configured a
new derivative stays `processing` and the dispatcher backs off. A derivative
that the retired in-process encoder left `processing` fails after the stalled
window and can be retried like any failed one.
Only `travel-video-v1` is supported. The v1 worker has no capability-discovery
endpoint; the fixed configured profile and every response's `api_version=v1`
are validated. A changed contract needs a new adapter/profile version.

Run a separately supervised dispatcher from the same backend release:

```sh
cd backend
uv run python -m app.media.worker
# Within the built backend image: python -m app.media.worker
```

The dispatcher needs the same DB/storage settings and private media-worker
URL/token/profile settings as the API. It runs independently of API requests;
API shutdown does not lose work. It must continue after switching NEW work
back to local. PostgreSQL `FOR UPDATE SKIP LOCKED` locks one due job; concurrent
dispatchers cannot import the same result. SQLite is for single-dispatcher local
tests only. Do not run a polling loop inside an API request or browser.

The URL is an operator-configured HTTP(S) origin, without credentials, query,
fragment or path. The mounted token must be ASCII without embedded whitespace,
at least 32 characters. Missing/invalid configuration fails closed. Ambient
HTTP proxies and redirects are disabled. Connect timeout is five seconds;
upload/download have bounded deadlines and sizes. No filenames, worker tokens,
source paths, worker IDs or diagnostic prose enter application responses or
logs. The dispatcher stores only stable `worker_unavailable`, `output_invalid`
or `submission_expired` diagnostics. Check its process plus due-job age and
sanitized DB state; restart it if it exits. Supervision/monitoring and VPS
activation are tracked in [apps#275](https://github.com/tjorim/apps/issues/275).

## Dispatcher diagnostics

The supervised dispatcher prints one content-free line for each committed state
change or failed attempt: `reason=<code> job_id=<opaque app job ID> attempts=<n>`.
Loop failures use `job_id=none attempts=0` and stable configuration, storage,
transport, database or worker reason codes. Exception text and tracebacks are
never logged. Normal unchanged polls and idle loops do not print lines.

For a one-shot maintenance snapshot using the same database configuration:

```bash
uv run python -m app.media.worker --counts
```

Output is JSON counts grouped by durable job state; `failed` counts rows with a
persisted error code (including retryable failures), rather than a cumulative
failure metric. No IDs, source keys or content are included. This command does
not need worker credentials or contact the worker. It can be run through the
existing container maintenance channel; no new metrics server, collector or
scheduled alert is introduced.

Submission holds a dispatcher-only PostgreSQL session advisory lock on a
separate connection. It releases all row locks before copying, hashing and
uploading the original, allowing owner deletion to complete during upload.
Other dispatchers skip the claimed job. After upload, a fresh locked read checks
the derivative, asset, source key and checksum. Deleted/replaced work retains
only its durable remote identity for cancellation on the next step, never a
late attachment. A process exit releases the advisory lock; the committed
`submitting` state still resolves retries using the original idempotency key.
Output import retains its existing row locks and storage/ACK ordering.

## Durable lifecycle and retry

Creating a remote derivative commits its `processing_backend=remote` and
`media_worker_jobs` outbox atomically. The job's opaque ID is its per-app
idempotency key; profile, audio choice and original checksum/key are fixed for
that attempt. Submission sends one bounded original byte stream with a
canonical payload digest and an opaque filename. The worker never mounts
Travel's storage. Transport conventions match Champagnefestival's distinct
signage adapter, while all review and publication behavior stays app-owned.

The dispatcher commits `submitting` before sending, then commits the returned
worker ID before inspecting results. A lost response retries the same key and
digest, including after restart. Admission contention, malformed responses,
auth/configuration failures and outages back off from 10 seconds to five minutes.
Internally `pending`, `submitting`, `queued` and `running` remain distinguishable;
the existing owner interface continues to show `processing`, `ready` or `failed`.
The local stalled clock never expires remote jobs: the worker owns encoding
heartbeats, restart recovery and time limits. Queue waits/outages do not become
local timeout failures.

Keep worker tombstones **at least seven days**, matching apps' default
`MEDIA_TOMBSTONE_SECONDS=604800`. An uncertain submission older than six days
fails for explicit owner retry rather than risking a new worker job after key
expiry. A missing/expired saved worker job also fails; it is never resubmitted
automatically. Owner retry creates a new attempt/key and detaches the prior
attempt for cleanup. New retries follow the explicitly configured backend;
existing remote submissions never silently fall back to local.

Successful output must contain exactly `video.mp4` and `poster.webp`. Downloads
are bounded by both declared size and Travel's 80 MiB ceiling per artifact and
verified against SHA256. Travel's retained ffprobe verifies actual H.264/yuv420p,
optional AAC, a single video, allowed streams, no chapters/source metadata or
rotation side data, even dimensions at most 1280 and finite duration at most
90.1 seconds. Evidence dimensions/duration must match. Pillow decodes the WebP,
checks matching dimensions and rejects EXIF/XMP/ICC metadata. Encoder policy
(90-second cap, bitrate, orientation baking and metadata stripping) remains the
worker's immutable profile; only `ffprobe` remains in the image, for verification.

The derivative and asset rows are locked while accepting output; trip identity,
original checksum, deletion and processing state are checked again. Video and
poster attach in the same transaction before `ready`, with review still
`pending`. Deterministic attempt-specific storage keys let interrupted imports
overwrite their staging bytes rather than leak a new file on every retry.
Rolled-back unrecorded output is removed when the job is cancelled/finished.
Filesystem writes fsync the bytes and directory entries before database commit.
Only a later transaction ACKs worker artifact deletion. Lost/repeated ACKs are
safe, and cannot re-import or duplicate active canonical objects.

Deleting a derivative detaches its outbox entry; soft-deleting an asset also
fails/detaches remote processing. The outbox survives hard deletion via
`ON DELETE SET NULL`, so cancellation/cleanup can continue after restart. A
possibly accepted submit is resolved by key without re-uploading a deleted
original, then cancelled and ACKed; a never-submitted deleted job sends nothing.
A worker success never restores a deleted asset or changes its visibility.
Failed work never serves the original as a visitor fallback.

## Validation and publication safety

`tests/test_media_worker.py` exercises real generated MP4/WebP validation and
v1 HTTP responses: lost submission, durable replay, queue/running state,
admission/outage/backoff, explicit rollback, deletion/cancellation, expired
results, corruption, pending review and lost ACK. The existing media/publication
suite still verifies owner isolation, metadata stripping, explicit approval,
public/unlisted scopes, and Range/poster delivery. No frontend routes/copy change.
Optional `TRAVEL_TEST_MEDIA_WORKER_URL` / `TRAVEL_TEST_MEDIA_WORKER_TOKEN_FILE`
run real-worker parity tests against a disposable local worker with synthetic
media; never point those tests at production. Optional `TRAVEL_TEST_DATABASE_URL`
points at a local PostgreSQL test database; locking/deletion-race tests create
and remove a random isolated schema there. For example:

```sh
cd backend
TRAVEL_TEST_MEDIA_WORKER_URL=http://127.0.0.1:18090 \
TRAVEL_TEST_MEDIA_WORKER_TOKEN_FILE=/path/outside/repo/test-token \
TRAVEL_TEST_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/travel_test \
  uv run pytest tests/test_media_worker.py tests/test_media_worker_postgres.py
```

Put the pinned ffmpeg/ffprobe from `backend/Dockerfile`'s base image on the test
PATH (as CI does): tests generate fixture videos with `ffmpeg` and verify output
with `ffprobe`; the production image carries only `ffprobe`.

Reviewed the [publication safety checklist](publication-safety-check.md) for
this integration: private originals and authored operational metadata never
enter visitor delivery; only the owner-reviewed, explicitly scoped derivative
and poster can be shared; captions/scopes/date precision remain owner choices;
documents and worker credentials have no visitor routes. No actual trip is
published as part of this work. Production owner preview/review and visitor
checks remain rollout gates in apps#275.

## Rollout and rollback

VPS service wiring and verification belong to apps#275 (cutover verified there
before the local encoder was removed). Record timestamps/image IDs,
resource/latency and cross-app/network-isolation evidence there before changing
any resource limits.

To roll back the encoder, redeploy the previous Travel release, which still has
the in-process encoder and `TRAVEL_VIDEO_PROCESSING_BACKEND=local`; migration 011
is additive, so that release runs on the current schema. Keep the dispatcher
(from this release) and worker credentials running until all remote work is
imported/ACKed or explicitly deleted/cancelled; failed remote attempts can use the
owner's existing retry action after reconciliation. Stop dispatchers and
reconcile all outstanding jobs before rolling back migration 011. Removing
`ffprobe` would need an alternative byte-level verification contract.
