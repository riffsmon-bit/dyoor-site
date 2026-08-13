import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { migrations } from "./migrations.js";

export type DatabaseConnection = Database.Database;

export function openDatabase(path: string): DatabaseConnection {
  const inMemory = path === ":memory:";
  const resolved = inMemory ? path : resolve(path);
  if (!inMemory) mkdirSync(dirname(resolved), { recursive: true, mode: 0o700 });

  const previousUmask = process.umask(0o077);
  let database: DatabaseConnection;
  try {
    database = new Database(resolved);
  } finally {
    process.umask(previousUmask);
  }
  if (!inMemory) chmodSync(resolved, 0o600);
  database.pragma("foreign_keys = ON");
  if (!inMemory) database.pragma("journal_mode = WAL");
  database.pragma("busy_timeout = 5000");
  return database;
}

export function migrateDatabase(database: DatabaseConnection): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const applied = new Set(
    database
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all()
      .map((row) => (row as { version: number }).version),
  );
  const apply = database.transaction((version: number, name: string, sql: string) => {
    database.exec(sql);
    database
      .prepare("INSERT INTO schema_migrations(version, name, applied_at) VALUES (?, ?, ?)")
      .run(version, name, new Date().toISOString());
  });
  for (const migration of migrations) {
    if (!applied.has(migration.version)) apply(migration.version, migration.name, migration.sql);
  }
}

export function openMigratedDatabase(path: string): DatabaseConnection {
  const database = openDatabase(path);
  migrateDatabase(database);
  return database;
}
