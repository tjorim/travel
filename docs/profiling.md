# Profiling Slow Requests

Python 3.15 ships a sampling profiler in the standard library, `profiling.sampling` ("Tachyon"). It reads the interpreter's stacks from outside the process, so the backend needs no code changes, no extra dependency and no restart to be profiled. Use it to investigate a specific slow route locally. It is **not enabled in production** (see [Production](#production)).

## Find the slow request first

Start from the request log, not the profiler. Every response carries `Server-Timing: app;dur=…, db;desc="N queries";dur=…` (visible in the browser devtools Network tab), and a request slower than 300 ms is logged as a warning with its method, route template, status, duration and query count (`backend/app/request_timing.py`). Many queries for one request is an N+1 pattern that the SQL log explains better than a profile does. A high `app` time with few queries is what a profile is for.

## Local setup

Run the backend against a local PostgreSQL with the dev auth bypass, so requests can be replayed with a fixed bearer token (see the [README](../README.md#run-locally) for the bypass):

```bash
cd backend
export TRAVEL_ENVIRONMENT=development \
  TRAVEL_DATABASE_URL=postgresql+psycopg://travel:travel@127.0.0.1:5432/travel \
  TRAVEL_DEV_AUTH_BYPASS_TOKEN=dev-profiling
uv run alembic upgrade head
```

The rate limits only cover the anonymous `/public/*` and `/shared/*` routes, so a replay loop against owner routes is not cut off. Set `TRAVEL_RATE_LIMIT_ENABLED=false` if you replay those.

## Choose the mode

Travel's route handlers are plain `def` functions, which FastAPI runs in its threadpool, so the work is spread over threads.

| Target | Flags | Why |
|---|---|---|
| Sync REST routes (`def` handlers in `app/routers`) | `--mode cpu -a` | Samples every thread, and counts on-CPU time only. Wall-clock mode is dominated by idle pool workers. |
| A request that is slow but not CPU-bound (waiting on the database or a remote service) | `--mode wall -a` | Wall time shows where it waits. |
| A request that hangs | `dump <pid>` | Prints what every thread is doing right now. |
| `async def` code (middleware, streaming responses) | `--async-aware` | Reconstructs stacks per asyncio task. Cannot be combined with `-a`. |

## Profile a fresh server

Start uvicorn under the profiler for a fixed duration, then replay the slow request while it runs:

```bash
uv run python -m profiling.sampling run --mode cpu -a -d 30 \
  --flamegraph -o /tmp/trips.html \
  -m uvicorn app.main:app --port 8000

# in another shell
for i in $(seq 300); do
  curl -s -o /dev/null -H 'Authorization: Bearer dev-profiling' http://localhost:8000/api/trips
done
```

The server stops when the window ends and the report is written then. Open the HTML in a browser, or use `--pstats -o /tmp/api.pstats` and read it from the terminal:

```bash
uv run python -c "import pstats; pstats.Stats('/tmp/api.pstats').sort_stats('cumulative').print_stats(r'app/', 25)"
```

The owner MCP endpoint over HTTP needs an OIDC token even locally, so it is not covered here.

## Attach to a running server

To catch a slowdown that only appears after the server has been up a while, attach by PID instead of restarting. Use the PID of the Python process that listens on the port (`ss -ltnp | grep :8000`), not the `uv run` wrapper that started it:

```bash
uv run python -m profiling.sampling attach --mode cpu -a -d 15 --flamegraph -o /tmp/attach.html <uvicorn-pid>
uv run python -m profiling.sampling dump <uvicorn-pid>
```

Attaching needs ptrace permission on the target. Locally that means the same user and `kernel.yama.ptrace_scope` 0, or running the profiler as root.

## Reading the output

- Under `-a`, expect roughly 10–15% of samples to be unreadable in the summary's error rate; that is samples that could not be read, not a sign the profile is broken.
- Compare against a baseline when checking a fix: record it with `--binary -o before.bin`, then run `--diff-flamegraph before.bin` on the second run.
- A profile holds function names, file paths, line numbers and sample counts, not argument or variable values. The flamegraph HTML also embeds the source lines of the sampled frames. Treat both as local diagnostics rather than something to publish.

## Production

Not enabled. Attaching to a container's PID 1 depends on the host's ptrace policy (`kernel.yama.ptrace_scope`), the container's seccomp profile and capabilities (`CAP_SYS_PTRACE`), and a collection and retention policy for profiles, which does not exist yet. Those belong to `tjorim/apps` and need their own review before anything changes there. Reproduce locally with production-like data volumes instead.

Measurements and decisions from the Python 3.15 upgrade are recorded in #390.
