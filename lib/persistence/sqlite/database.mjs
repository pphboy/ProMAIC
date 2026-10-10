import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

function sqliteError(error) {
  if (error && [5, 6].includes(error.errcode & 255)) {
    const busy = new Error('SQLite database is locked; retry the operation', { cause: error });
    busy.name = 'StorageBusyError';
    busy.code = 'SQLITE_BUSY';
    busy.retryAfterSeconds = 1;
    return busy;
  }
  return error;
}

/**
 * The only low-level SQLite owner. Work must be synchronous inside transactions:
 * a promise would release the write lock before the caller's work finished.
 */
export class LocalDatabase {
  #db;
  #depth = 0;
  #closed = false;

  constructor(filename, { busyTimeoutMs = 5000 } = {}) {
    if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0 || busyTimeoutMs > 60000) {
      throw new Error('SQLite busyTimeoutMs must be an integer between 0 and 60000');
    }
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.#db = new DatabaseSync(filename);
    try {
      this.#db.exec(`PRAGMA foreign_keys = ON; PRAGMA busy_timeout = ${busyTimeoutMs};`);
      this.#db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
    } catch (error) {
      this.#db.close();
      throw error;
    }
  }

  exec(sql) {
    try {
      return this.#db.exec(sql);
    } catch (error) {
      throw sqliteError(error);
    }
  }
  prepare(sql) {
    const statement = this.#db.prepare(sql);
    return Object.fromEntries(
      ['run', 'get', 'all'].map((method) => [
        method,
        (...args) => {
          try {
            return statement[method](...args);
          } catch (error) {
            throw sqliteError(error);
          }
        },
      ]),
    );
  }

  transaction(body) {
    // An async function may mutate after its first await even after rollback.
    if (body.constructor.name === 'AsyncFunction') {
      throw new TypeError('SQLite transactions require a synchronous callback');
    }
    const depth = this.#depth;
    const savepoint = `local_tx_${depth}`;
    this.exec(depth ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
    this.#depth++;
    try {
      const result = body(this);
      if (result && typeof result.then === 'function') {
        throw new TypeError('SQLite transaction callbacks must not return a promise');
      }
      this.#db.exec(depth ? `RELEASE SAVEPOINT ${savepoint}` : 'COMMIT');
      return result;
    } catch (error) {
      if (depth) {
        this.#db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}; RELEASE SAVEPOINT ${savepoint}`);
      } else {
        this.#db.exec('ROLLBACK');
      }
      throw error;
    } finally {
      this.#depth--;
    }
  }

  /** Each namespace owns an append-only migration ladder with immutable SQL. */
  migrate(namespace, migrations) {
    if (!namespace || !Array.isArray(migrations)) throw new TypeError('Invalid migrations');
    migrations.forEach((migration, index) => {
      if (migration.version !== index + 1 || typeof migration.sql !== 'string') {
        throw new Error('SQLite migrations must have contiguous versions starting at 1');
      }
    });
    this.transaction(() => {
      this.#db.exec(`CREATE TABLE IF NOT EXISTS local_schema_migrations (
        namespace TEXT NOT NULL, version INTEGER NOT NULL, checksum TEXT NOT NULL,
        applied_at INTEGER NOT NULL, PRIMARY KEY (namespace, version))`);
      const applied = this.#db
        .prepare(
          'SELECT version, checksum FROM local_schema_migrations WHERE namespace = ? ORDER BY version',
        )
        .all(namespace);
      if (applied.length > migrations.length)
        throw new Error(`Unsupported future schema: ${namespace}`);
      for (const [index, row] of applied.entries()) {
        const expected = migrations[index];
        const checksum = createHash('sha256').update(expected.sql).digest('hex');
        if (row.version !== expected.version || row.checksum !== checksum) {
          throw new Error(`SQLite migration checksum mismatch: ${namespace}/${row.version}`);
        }
      }
      for (const migration of migrations.slice(applied.length)) {
        this.#db.exec(migration.sql);
        this.#db
          .prepare('INSERT INTO local_schema_migrations VALUES (?, ?, ?, ?)')
          .run(
            namespace,
            migration.version,
            createHash('sha256').update(migration.sql).digest('hex'),
            Date.now(),
          );
      }
    });
  }

  close() {
    if (this.#closed) return;
    if (this.#depth) throw new Error('Cannot close SQLite during a transaction');
    this.#db.close();
    this.#closed = true;
  }
}
