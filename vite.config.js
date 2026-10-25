import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import process from "node:process";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

const host = process.env.TAURI_DEV_HOST;

/**
 * Sert les donnees du mode apercu (.apercu/, copie de la base et rapports) sous
 * /apercu/, en developpement SEULEMENT. Placees dans public/, elles partiraient
 * dans l'appli compilee : une copie des donnees personnelles dans l'installeur.
 */
function apercu() {
  const dossier = path.resolve(import.meta.dirname, ".apercu");
  return {
    name: "sitedashboard-apercu",
    apply: "serve",
    configureServer(serveur) {
      serveur.middlewares.use("/apercu", (requete, reponse, suivant) => {
        const nom = path.basename(decodeURIComponent(requete.url.split("?")[0]));
        const fichier = path.join(dossier, nom);
        if (!nom || !existsSync(fichier)) return suivant();
        const types = { ".wasm": "application/wasm", ".json": "application/json" };
        reponse.setHeader("Content-Type", types[path.extname(nom)] ?? "application/octet-stream");
        reponse.end(readFileSync(fichier));
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [react(), tailwindcss(), apercu()],

  // Options taillees pour `tauri dev` / `tauri build`
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{js,jsx}", "controles/**/*.test.mjs"],
  },
}));
