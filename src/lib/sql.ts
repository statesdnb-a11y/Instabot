import Database from "better-sqlite3";
import { createClient, type Client, type InArgs, type InValue } from "@libsql/client";
import { DB_PATH, ensureDataDirs } from "@/lib/paths";

export type Sql = {
  exec(sql: string): Promise<void>;
  get<T>(sql: string, ...args: unknown[]): Promise<T | undefined>;
  all<T>(sql: string, ...args: unknown[]): Promise<T[]>;
  run(sql: string, ...args: unknown[]): Promise<{ changes: number }>;
};

function named(args: unknown[]): Record<string, unknown> | null {
  if (args.length !== 1) return null;
  const value = args[0];
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalize<T>(row: unknown): T {
  const source = row as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (/^\d+$/.test(key)) continue;
    const value = source[key];
    out[key] = typeof value === "bigint" ? Number(value) : value;
  }
  return out as T;
}

function localSql(db: Database.Database): Sql {
  return {
    async exec(sql) {
      db.exec(sql);
    },
    async get<T>(sql: string, ...args: unknown[]) {
      const stmt = db.prepare(sql);
      const record = named(args);
      const row = record ? stmt.get(record) : stmt.get(...args);
      return row as T | undefined;
    },
    async all<T>(sql: string, ...args: unknown[]) {
      const stmt = db.prepare(sql);
      const record = named(args);
      const rows = record ? stmt.all(record) : stmt.all(...args);
      return rows as T[];
    },
    async run(sql, ...args) {
      const stmt = db.prepare(sql);
      const record = named(args);
      const result = record ? stmt.run(record) : stmt.run(...args);
      return { changes: Number(result.changes) };
    },
  };
}

function remoteArgs(args: unknown[]): InArgs {
  const record = named(args);
  if (!record) return args as InValue[];
  const out: Record<string, InValue> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) out[key] = null;
    else out[key] = value as InValue;
  }
  return out;
}

function remoteSql(client: Client): Sql {
  return {
    async exec(sql) {
      await client.executeMultiple(sql);
    },
    async get<T>(sql: string, ...args: unknown[]) {
      const result = await client.execute({ sql, args: remoteArgs(args) });
      const row = result.rows[0];
      return row ? normalize<T>(row) : undefined;
    },
    async all<T>(sql: string, ...args: unknown[]) {
      const result = await client.execute({ sql, args: remoteArgs(args) });
      return result.rows.map((row) => normalize<T>(row));
    },
    async run(sql, ...args) {
      const result = await client.execute({ sql, args: remoteArgs(args) });
      return { changes: Number(result.rowsAffected) };
    },
  };
}

export function tursoEnabled() {
  return Boolean(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);
}

export function openSql(): Sql {
  if (tursoEnabled()) {
    const client = createClient({
      url: process.env.TURSO_DATABASE_URL ?? "",
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    return remoteSql(client);
  }
  ensureDataDirs();
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  return localSql(db);
}
