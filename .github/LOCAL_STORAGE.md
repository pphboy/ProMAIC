# Local storage architecture

`lib/persistence/backend-config.ts` is the server-side configuration boundary.
No backend selection plus no DATABASE_URL selects SQLite. Existing explicit
PostgreSQL URLs retain their backend. Conflicting SQLite/PostgreSQL or cloud
media configuration fails explicitly. Local library, document, runtime, media, and model-setting routes select their
SQLite adapters before entering PostgreSQL paths. Unsupported background and
cloud capabilities are gated in local mode.

`OPENMAIC_DATA_DIR` must be absolute. Desktop launches pass a `data` directory
under Electron userData. Without desktop configuration the default is
`%LOCALAPPDATA%\ProMAIC\data` on Windows or `~/ProMAIC/data` elsewhere, independent
of the current working directory. The database is `openmaic.sqlite`; asset
bytes and temporary import files belong in `assets/` and `tmp/`.

`lib/persistence/sqlite/database.mjs` owns the SQLite connection. It uses the
Node built-in driver, enables foreign keys and WAL, and bounds lock waits.
Keep SQL in backend-specific repositories: never emulate PostgreSQL syntax
with string replacement. JSON is explicit text encoding and timestamps are
integer milliseconds. Run the same behavior contracts against each backend.

Migration ladders are namespaced, contiguous from version 1, and immutable.
Each applied SQL body has a SHA-256 checksum. Changed historical SQL, gaps, or a
future schema must fail, never silently reset data. Pending migrations apply
in one transaction; failure rolls the batch back.

Transactions are synchronous and short, with BEGIN IMMEDIATE and nested
savepoints. Never return promises, call async helpers, or start asynchronous
work from a transaction callback. File/network work runs outside transactions.
Callers must not treat a successful file write as a committed course import;
publish asset metadata and course references only after files are ready.

Back up only with the application stopped. Copy the entire data directory,
including media and any SQLite WAL/SHM files. Restore the directory while the
application is stopped and use a compatible application/schema version. Keep
a complete pre-upgrade copy for rollback; do not downgrade schema in place.

SQLite schema namespaces are `documents` (courses/scenes/folders), `runtime`
(learner sessions/records), `assets` (registry and course reference relation),
and `settings` (revisioned, sealed model configuration). New persistent features
need a new append-only migration and repository methods; do not use a fake
PostgreSQL connection or change checksummed historical SQL. Media bytes are
published before metadata and references; collection keeps referenced bytes
and waits a grace period before removing unreferenced files.
