import { Bot, ChevronRight, CircleX, Globe, Lock, PartyPopper, Plug, Repeat } from "lucide-react";
import { EtatVide } from "./ui";

const ICONES = { check: CircleX, certificat: Lock, domaine: Globe, agent: Bot, abonnement: Repeat, connecteur: Plug };
const TONS = {
  ko: "bg-ko/12 text-ko",
  alerte: "bg-alerte/12 text-alerte",
  info: "bg-info/12 text-info",
};

/** Les points « A traiter », cliquables : vue d'ensemble et panneau de la cloche. */
export default function ListeATraiter({ liste, onOuvrirCible, className = "" }) {
  if (liste.length === 0) return <EtatVide Icone={PartyPopper}>Rien à traiter : tout est au vert.</EtatVide>;
  return (
    <ul className={`-mx-2 flex flex-col overflow-y-auto ${className}`}>
      {liste.map((t) => {
        const Icone = ICONES[t.icone] ?? CircleX;
        return (
          <li key={t.cle}>
            <button
              type="button"
              onClick={() => onOuvrirCible(t.cible)}
              title={t.texte ?? t.detail}
              className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left transition hover:bg-surface-2"
            >
              <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${TONS[t.ton]}`}>
                <Icone size={16} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{t.titre}</span>
                <span className="block truncate text-xs text-texte-doux">{t.detail}</span>
              </span>
              <ChevronRight size={15} className="shrink-0 text-pale" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
