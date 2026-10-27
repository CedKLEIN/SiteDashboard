import { createContext, useCallback, useContext, useRef, useState } from "react";
import { CircleCheck, TriangleAlert, X } from "lucide-react";

const Contexte = createContext({ afficher: () => {} });

/** Duree d'affichage par defaut : le temps de lire et de cliquer « Annuler ». */
const DUREE_MS = 6000;

/**
 * Messages ephemeres en bas de l'ecran : « Depense supprimee — Annuler ».
 * `afficher({ message, action: { libelle, onClick }, ton, duree })`.
 */
export function FournisseurToasts({ children }) {
  const [toasts, setToasts] = useState([]);
  const suivant = useRef(0);

  const fermer = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const afficher = useCallback(
    ({ message, action = null, ton = "ok", duree = DUREE_MS }) => {
      suivant.current += 1;
      const id = suivant.current;
      setToasts((t) => [...t.slice(-2), { id, message, action, ton }]);
      setTimeout(() => fermer(id), duree);
    },
    [fermer],
  );

  return (
    <Contexte.Provider value={{ afficher }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex flex-col items-center gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex items-center gap-3 rounded-xl bg-surface-3 py-2.5 pr-2.5 pl-4 text-[13px] text-texte shadow-2xl ring-1 ring-bord"
            style={{ animation: "apparaitre 160ms ease-out" }}
          >
            {t.ton === "ko" ? <TriangleAlert size={15} className="text-ko" /> : <CircleCheck size={15} className="text-ok" />}
            <span>{t.message}</span>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  fermer(t.id);
                  t.action.onClick();
                }}
                className="rounded-md px-2 py-1 font-semibold text-accent-2 hover:bg-surface-2"
              >
                {t.action.libelle}
              </button>
            )}
            <button type="button" onClick={() => fermer(t.id)} className="rounded-md p-1 text-texte-doux hover:bg-surface-2" aria-label="Fermer">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </Contexte.Provider>
  );
}

export function useToasts() {
  return useContext(Contexte);
}

/**
 * Supprime en laissant quelques secondes pour annuler. `supprimer` renvoie la
 * photo de la ligne (voir `supprimerAnnulable`), `onChange` relit les ecrans.
 */
export function useSuppressionAnnulable(onChange) {
  const { afficher } = useToasts();
  return useCallback(
    async (message, supprimer, restaurer) => {
      try {
        const photo = await supprimer();
        onChange?.();
        afficher({
          message,
          action: {
            libelle: "Annuler",
            onClick: async () => {
              try {
                await restaurer(photo);
                onChange?.();
                afficher({ message: "Restauré." });
              } catch (e) {
                afficher({ message: `Restauration impossible : ${e?.message ?? e}`, ton: "ko" });
              }
            },
          },
        });
      } catch (e) {
        afficher({ message: `Suppression impossible : ${e?.message ?? e}`, ton: "ko" });
      }
    },
    [afficher, onChange],
  );
}
