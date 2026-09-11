import Database from "@tauri-apps/plugin-sql";

const DB_URL = "sqlite:sitedashboard.db";

let instance = null;

/**
 * Connexion SQLite unique, partagee par toute l'appli.
 * Les migrations sont jouees cote Rust au demarrage (voir src-tauri/src/lib.rs).
 */
export async function db() {
  if (!instance) {
    instance = await Database.load(DB_URL);
  }
  return instance;
}

/** SELECT -> tableau de lignes. Placeholders SQLite: $1, $2, ... */
export async function select(sql, params = []) {
  const conn = await db();
  return conn.select(sql, params);
}

/** INSERT / UPDATE / DELETE -> { rowsAffected, lastInsertId } */
export async function execute(sql, params = []) {
  const conn = await db();
  return conn.execute(sql, params);
}
