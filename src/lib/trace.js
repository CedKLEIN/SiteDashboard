import { invoke } from "@tauri-apps/api/core";

/**
 * Relaie les erreurs du front vers le terminal de `tauri dev`.
 * Une exception dans la WebView ne remonte nulle part autrement: sans ce relais,
 * un plantage au rendu ou un cycle de supervision casse passent inapercus.
 */
export function tracer(niveau, message) {
  invoke("tracer", { niveau, message: String(message) }).catch(() => {});
}

/** Branche les erreurs non rattrapees (rendu React inclus) sur la trace. */
export function installerTraceGlobale() {
  window.addEventListener("error", (e) => {
    tracer("erreur", `${e.message} @ ${e.filename}:${e.lineno}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    tracer("rejet", e.reason?.stack ?? e.reason);
  });
}
