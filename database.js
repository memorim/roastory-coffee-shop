import { schemaSql } from "./schema.js";
import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import { seedSql } from './seed.js';
const context = new AsyncLocalStorage();

// Serialize local statements while a transaction spans asynchronous object I/O.
// PostgreSQL uses a dedicated connection for each transaction instead.
export function adaptDatabase(raw) {
  if (raw.kind) return raw;
  let queue = Promise.resolve();
  const execute = fn => {
    if (context.getStore() === raw) return Promise.resolve().then(fn);
    const result = queue.then(fn); queue = result.catch(() => {}); return result;
  };
  return {
    kind: 'sqlite',
    prepare(sql) { return Object.fromEntries(['get','all','run'].map(method =>
      [method, (...args) => execute(() => raw.prepare(sql)[method](...args))])); },
    transaction(fn) { return execute(() => context.run(raw, async () => {
      raw.exec('BEGIN IMMEDIATE');
      try { const result = await fn(); raw.exec('COMMIT'); return result; }
      catch (error) { raw.exec('ROLLBACK'); throw error; }
    })); },
  };
}

export function postgresOptions(connectionString) {
  const url = new URL(connectionString);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  for (const key of ['sslmode','sslcert','sslkey','sslrootcert','ssl']) url.searchParams.delete(key);
  return { connectionString: url.toString(), ssl: local ? false : { rejectUnauthorized: true },
    max: 3, connectionTimeoutMillis: 15000, idleTimeoutMillis: 10000,
    types: { getTypeParser(oid, format) { return oid === 20 ? Number : pg.types.getTypeParser(oid, format); } } };
}
function statement(sql, args) {
  let values = args, n = 0;
  if (args.length === 1 && args[0] && typeof args[0] === 'object') {
    const named = args[0]; values = [];
    sql = sql.replace(/\$[a-z_]+/gi, key => { values.push(named[key]); return '$' + values.length; });
  } else sql = sql.replace(/\?/g, () => '$' + (++n));
  // The one portable budget expression has a scalar minimum, not an aggregate.
  sql = sql.replace(/MIN\(count\+1,/g, 'LEAST(request_budgets.count+1,')
    .replace(/\breset_at<=/g, 'request_budgets.reset_at<=')
    .replace(/ELSE reset_at END/g, 'ELSE request_budgets.reset_at END');
  if (/^INSERT INTO (orders)\(/i.test(sql.trim()) && !/RETURNING/i.test(sql)) sql += ' RETURNING id';
  sql = sql.replace(/stock IS (\$\d+)/g, 'stock IS NOT DISTINCT FROM $1');
  if (/INSERT OR IGNORE/i.test(sql)) sql = sql.replace('INSERT OR IGNORE','INSERT') + ' ON CONFLICT DO NOTHING';
  return { text: sql, values };
}
export async function createPostgres(connectionString = process.env.DATABASE_URL) {
  const pool = new pg.Pool(postgresOptions(connectionString));
  pool.on('error',()=>console.error({event:'database_unavailable'}));
  const db = {
    kind: 'postgres', pool,
    prepare(sql) {
      const query = (...args) => (context.getStore()?.pool === pool ? context.getStore().client : pool).query(statement(sql, args));
      return { all: async (...args) => (await query(...args)).rows,
        get: async (...args) => (await query(...args)).rows[0],
        run: async (...args) => { const r = await query(...args); return {changes: r.rowCount, lastInsertRowid: r.rows[0]?.id}; } };
    },
    async transaction(fn) {
      const client = await pool.connect();
      try { await client.query('BEGIN');
        // One order lock covers all checkout writers, including separate replicas.
        await client.query('SELECT pg_advisory_xact_lock(49180242)');
        const value = await context.run({pool, client}, fn); await client.query('COMMIT'); return value;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
    close: () => pool.end(),
  };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(49180243)');
    const initialized = (await client.query("SELECT to_regclass('products') AS existing")).rows[0].existing;
    await client.query(schemaSql);
    if (!initialized) {
      await client.query(seedSql);
      await client.query('UPDATE products SET stock=100');
    }
    await client.query('COMMIT');
  } catch(error) { await client.query('ROLLBACK');client.release();await pool.end();throw error; }
  client.release();return db;
}
