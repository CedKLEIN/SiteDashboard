import { useEffect } from "react";
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

/**
 * Notifie les changements d'etat des sites a chaque `rafraichissement` (le
 * cycle de supervision), et ceux des agents attendus quand leur liste change.
 */
export function useNotifications(rafraichissement, attendus) {
  useEffect(() => {
    (async () => suiviSites(elementsSites(await etatsDesSites()), await actives()))().catch((e) =>
      tracer("notification", `suivi des sites impossible: ${e}`),
    );
  }, [rafraichissement]);

  useEffect(() => {
    (async () => suiviAgents(elementsAgents(attendus), await actives()))().catch((e) =>
      tracer("notification", `suivi des agents impossible: ${e}`),
    );
  }, [attendus]);
}
