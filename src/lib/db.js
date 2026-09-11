import Database from "@tauri-apps/plugin-sql";

const DB_URL = "sqlite:sitedashboard.db";

/**
 * On memorise la PROMESSE, pas la connexion resolue.
 * Sinon les appels concurrents (le tableau de bord tire 5 requetes en Promise.all,
 * et StrictMode double l'effet en dev) partent tous avant que le premier `await`
 * ait rendu la main, et ouvrent chacun leur connexion -> "database is locked".
 */
let connexion = null;

export function db() {
  if (!connexion) {
    connexion = Database.load(DB_URL)
      .then(async (conn) => {
        // WAL: un lecteur ne bloque plus l'ecrivain (et inversement).
        await conn.select("PRAGMA journal_mode = WAL");
        // Filet de securite: on patiente au lieu d'echouer si le verrou est pris.
        await conn.select("PRAGMA busy_timeout = 5000");
        return conn;
      })
      .catch((erreur) => {
        // Sans ca, un echec transitoire condamnerait la connexion pour toute la session
        connexion = null;
        throw erreur;
      });
  }
  return connexion;
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
