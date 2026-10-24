# PH-M01 display preparation

This is the local procedure for a later display check. It does not start the server, the browser, or a fetch. The browser pre-request block is **not ready**.

## Browser

`cursor-ide-browser` can click, navigate, and send individual CDP commands. It does not provide a verified request-stage blocker, and its CDP tool rejects browser-wide commands. A page script wrapped around `fetch` or XHR does not see the document navigation, redirects, or parser-started subresources. This slice does not open CDP to find out whether `Fetch.enable` is accepted. Until a supported tool can block those channels before the request is sent, do not treat the display as egress-safe and do not substitute a request log.

Do not click an original-article or off-site link. Do not change the machine proxy, DNS, firewall, or certificates.

## Server hook

Start only the display copy, with the guard preloaded before `dist/output/server/index.mjs`:

- `cwd`: a new directory under this worktree's `.tmp`
- `HOST` and `NITRO_HOST`: `127.0.0.1`
- `PORT` and `NITRO_PORT`: the chosen display port
- `SHIPPING_DATA_MODE=real`
- `SHIPPING_RUNTIME_ENABLED=false`
- `SHIPPING_INTEL_ENABLED=false`
- `PH_M01_DISPLAY_ALLOW` empty

The hook rejects DNS, TCP, TLS, HTTP(S), HTTP/2, `fetch`, UDP send, and `child_process` unless the target is an allow-listed `127.0.0.1` port. This launch allow-list is empty, because the `/feed` read path does not open an outbound socket. SQLite uses a file, not the network. The hook is not an OS firewall: a native addon can still call `connect`, and later JavaScript can replace the wrapped methods.

Clearing provider keys, turning Runtime off, or seeing unchanged counters is not the network control. The old outbound recorder only writes a log.

## Copy and windows

The original `ph-m01.sqlite3` stays read-only. Copy it with SQLite `backup()` into a directory that does not exist yet, is inside `.tmp`, and is not an existing acceptance or DeepSeek directory. Record SHA-256, device, and inode before and after. If `-wal` or `-shm` exists, or the hash or identity changes, stop. Do not hash only the main file and call a WAL database complete.

Startup and the first `GET /api/shipping` may update `app_metadata.last_migration_at`, `data_mode`, `schema_version`, and a previously empty `bootstrap_completed_at`. They may insert a missing `settings` or `port_directory_status` row and append new `schema_migrations` versions. Capture the baseline after that first shipping response. Later `/feed` reads must match titles, canonical URLs, dates, version rows, block text, every user-table digest, and `data_version`. `intel_fetch_run` stays 1 and `provider_usage` / `provider_runtime` stay 0. A restart is a new init window.

## Stop

Save the child handle, PID, entry, cwd, and start time from `spawn`. Do not identify the process by searching for the cwd on a command line.

On this Windows Node, `child.kill("SIGTERM" | "SIGINT" | "SIGBREAK")` terminates the process without running JavaScript signal handlers. `taskkill` without `/F` does not stop it. Those are not graceful shutdown. The preload listens on `127.0.0.1` and a matching token emits `SIGTERM` inside the child, which is the signal Nitro's listener already handles: close the HTTP server, run the close hook, then the server's own `process.exit`. After that, check the exit code and the display port and shutdown port separately. A closed port with a live process is a failed stop. On timeout, record the PID, cwd, and log tails; do not kill an unrelated process and do not report success.
