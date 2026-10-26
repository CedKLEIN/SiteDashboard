import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { creerSuivi, elementsAgents, elementsSites } from "./notifications";
import { etatsDesSites, lirePreference } from "./queries";
import { tracer } from "./trace";

/** Preference '1' (defaut) ou '0'. */
export const CLE_NOTIFICATIONS = "notifications_actives";

// Au niveau du module et non dans un useRef : un seul suivi pour toute la vie de
// l'appli, que le composant soit remonte ou que StrictMode double l'effet.
const suiviSites = creerSuivi();
const suiviAgents = creerSuivi();

async function actives() {
  return (await lirePreference(CLE_NOTIFICATIONS, "1")) !== "0";
}

/** true si Windows affiche les notifications ; false si elles y sont coupees pour toutes les applis. */
export async function notificationsWindows() {
  try {
    return await invoke("notifications_windows");
  } catch (e) {
    tracer("notification", `etat des notifications Windows illisible: ${e}`);
    return true;
  }
}

/**
 * Notifie les changements d'etat des sites a chaque `rafraichissement` (le
 * cycle de supervision), et ceux des agents attendus quand leur liste change.
 *
 * Renvoie `bloqueesParWindows` : les notifications sont activees dans
 * SiteDashboard mais coupees dans Windows, qui les jette sans rien dire. L'appli
 * doit alors le montrer, sinon une alerte importante se perd.
 */
export function useNotifications(rafraichissement, attendus) {
  const [bloqueesParWindows, setBloqueesParWindows] = useState(false);

  useEffect(() => {
    let annule = false;
    (async () => {
      const voulues = await actives();
      await suiviSites(elementsSites(await etatsDesSites()), voulues);
      const bloquees = voulues && !(await notificationsWindows());
      if (!annule) setBloqueesParWindows(bloquees);
    })().catch((e) => tracer("notification", `suivi des sites impossible: ${e}`));
    return () => {
      annule = true;
    };
  }, [rafraichissement]);

  useEffect(() => {
    (async () => suiviAgents(elementsAgents(attendus), await actives()))().catch((e) =>
      tracer("notification", `suivi des agents impossible: ${e}`),
    );
  }, [attendus]);

  return { bloqueesParWindows };
}
