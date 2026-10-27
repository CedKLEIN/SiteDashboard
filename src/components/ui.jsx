import { useEffect, useRef, useState } from "react";
import { Check, Copy, Ellipsis, X } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { tracer } from "../lib/trace";

/**
 * Petit bouton qui copie un texte dans le presse-papiers.
 *
 * Pour ce que la selection a la souris attrape mal : un texte tronque par
 * une ellipse, ou plusieurs lignes qu'on veut coller d'un bloc. `texte` peut
 * etre une fonction, evaluee au clic seulement.
 */
export function BoutonCopier({ texte, titre = "Copier", className = "" }) {
  const [copie, setCopie] = useState(false);

  async function copier(evenement) {
    // Dans une ligne cliquable, copier ne doit pas aussi l'ouvrir ou la replier
    evenement.stopPropagation();
    try {
      await writeText(typeof texte === "function" ? texte() : String(texte ?? ""));
      setCopie(true);
      setTimeout(() => setCopie(false), 1500);
    } catch (e) {
      tracer("copie", `copie impossible: ${e}`);
    }
  }

  return (
    <button
      type="button"
      onClick={copier}
      title={copie ? "Copie !" : titre}
      aria-label={titre}
      className={`shrink-0 rounded p-1 text-texte-doux opacity-60 transition hover:bg-surface-2 hover:text-texte hover:opacity-100 ${className}`}
    >
      {copie ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

export function Carte({ titre, action, className = "", sansMarge = false, children }) {
  return (
    <section className={`rounded-2xl bg-surface ring-1 ring-bord ${sansMarge ? "" : "p-5"} ${className}`}>
      {(titre || action) && (
        <header className={`mb-4 flex items-center justify-between gap-3 ${sansMarge ? "px-5 pt-5" : ""}`}>
          {titre && <h2 className="text-[13px] font-semibold tracking-tight text-texte">{titre}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

const TONS_KPI = {
  neutre: "var(--color-accent-2)",
  depense: "var(--color-depense)",
  revenu: "var(--color-revenu)",
  abonnement: "var(--color-abonnement)",
  ok: "var(--color-ok)",
  alerte: "var(--color-alerte)",
  ko: "var(--color-ko)",
  info: "var(--color-info)",
};

/**
 * Indicateur chiffre. `ton` colore l'icone (et la valeur si `valeurColoree`) ;
 * `delta` est un ecart deja formate (« +18 % »), `bon` dit s'il va dans le bon
 * sens : une hausse des depenses est mauvaise, celle des revenus est bonne.
 */
export function Kpi({ libelle, valeur, detail, ton = "neutre", Icone = null, delta = null, bon = true, points = null, valeurColoree = false }) {
  const couleur = TONS_KPI[ton] ?? TONS_KPI.neutre;
  return (
    <div className="rounded-2xl bg-surface p-4 ring-1 ring-bord">
      <div className="flex items-center gap-2 text-xs font-medium text-texte-doux">
        {Icone && (
          <span
            className="grid size-6 shrink-0 place-items-center rounded-md"
            style={{ background: `color-mix(in srgb, ${couleur} 15%, transparent)`, color: couleur }}
          >
            <Icone size={13} />
          </span>
        )}
        {libelle}
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <p
            className="chiffres truncate text-2xl leading-none font-semibold tracking-tight"
            style={valeurColoree ? { color: couleur } : undefined}
          >
            {valeur}
          </p>
          {delta && (
            <p className={`mt-2 text-xs font-medium ${bon ? "text-ok" : "text-ko"}`}>
              {delta}
              {detail && <span className="ml-1.5 font-normal text-pale">{detail}</span>}
            </p>
          )}
          {!delta && detail && <p className="mt-2 truncate text-xs text-pale">{detail}</p>}
        </div>
        {points && points.length > 1 && <Sparkline points={points} couleur={couleur} />}
      </div>
    </div>
  );
}

/** Mini-courbe sans axes, pour la tendance d'un indicateur. */
export function Sparkline({ points, couleur, className = "h-8 w-24" }) {
  const max = Math.max(...points);
  const min = Math.min(...points);
  const d = points
    .map((v, i) => `${(i / (points.length - 1)) * 100},${28 - ((v - min) / (max - min || 1)) * 24}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 30" className={`shrink-0 ${className}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={d} fill="none" stroke={couleur} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Bouton({ variante = "primaire", className = "", ...props }) {
  const variantes = {
    primaire: "bg-accent text-white shadow-sm shadow-accent/25 hover:brightness-110",
    fantome: "text-texte-doux ring-1 ring-bord hover:bg-surface-2 hover:text-texte",
    discret: "text-texte-doux hover:bg-surface-2 hover:text-texte",
    danger: "text-ko hover:bg-ko/10",
  };
  return (
    <button
      type="button"
      className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${variantes[variante]} ${className}`}
      {...props}
    />
  );
}

const CLASSE_SAISIE =
  "rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-texte ring-1 ring-bord outline-none placeholder:text-pale focus:ring-accent disabled:opacity-50";

export function Champ({ label, className = "", ...props }) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      {label && <span className="text-xs font-medium text-texte-doux">{label}</span>}
      <input className={CLASSE_SAISIE} {...props} />
    </label>
  );
}

export function Selecteur({ label, children, className = "", ...props }) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      {label && <span className="text-xs font-medium text-texte-doux">{label}</span>}
      <select className={CLASSE_SAISIE} {...props}>
        {children}
      </select>
    </label>
  );
}

export function Pastille({ couleur }) {
  return (
    <span
      className="inline-block size-2.5 shrink-0 rounded-full"
      style={{ background: couleur || "var(--color-accent)" }}
    />
  );
}

export function EtatVide({ children, Icone = null, action = null }) {
  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      {Icone && (
        <span className="grid size-11 place-items-center rounded-2xl bg-surface-2 text-pale">
          <Icone size={20} />
        </span>
      )}
      <p className="text-[13px] text-texte-doux">{children}</p>
      {action}
    </div>
  );
}

/**
 * Icone d'un site : son favicon, sinon son initiale sur un fond teinte de sa
 * couleur. La couleur du site sert a le reconnaitre, jamais a dire son etat.
 */
export function Monogramme({ site, taille = 32, className = "" }) {
  const style = { width: taille, height: taille };
  if (site?.favicon) {
    return (
      <img
        src={site.favicon}
        alt=""
        aria-hidden="true"
        style={style}
        className={`shrink-0 rounded-lg bg-surface-2 object-contain p-[3px] ring-1 ring-bord ${className}`}
      />
    );
  }
  const couleur = site?.couleur || "var(--color-accent)";
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-lg font-semibold ${className}`}
      style={{
        ...style,
        fontSize: Math.round(taille * 0.42),
        color: couleur,
        background: `color-mix(in srgb, ${couleur} 15%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${couleur} 25%, transparent)`,
      }}
    >
      {(site?.nom ?? "?").charAt(0).toUpperCase()}
    </span>
  );
}

/** Choix exclusif en boutons accoles (periode, filtre). */
export function Segments({ options, valeur, onChanger, className = "", taille = "text-xs" }) {
  return (
    <div className={`inline-flex rounded-lg bg-surface-2 p-0.5 ring-1 ring-bord ${className}`} role="group">
      {options.map((o) => (
        <button
          key={o.cle}
          type="button"
          aria-pressed={o.cle === valeur}
          onClick={() => onChanger(o.cle)}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1 font-medium whitespace-nowrap transition ${taille} ${
            o.cle === valeur ? "bg-surface-3 text-texte shadow-sm" : "text-texte-doux hover:text-texte"
          }`}
        >
          {o.Icone && <o.Icone size={13} />}
          {o.libelle}
        </button>
      ))}
    </div>
  );
}

/** Onglets soulignes d'une page (fiche site, Finances, Reglages). */
export function Onglets({ options, valeur, onChanger }) {
  return (
    <div className="flex gap-6 border-b border-bord text-[13px] font-medium" role="tablist">
      {options.map((o) => (
        <button
          key={o.cle}
          type="button"
          role="tab"
          aria-selected={o.cle === valeur}
          onClick={() => onChanger(o.cle)}
          className={`-mb-px flex items-center gap-1.5 border-b-2 pb-3 transition ${
            o.cle === valeur ? "border-accent text-texte" : "border-transparent text-texte-doux hover:text-texte"
          }`}
        >
          {o.libelle}
          {o.compte > 0 && (
            <span className={`rounded-full px-1.5 text-[11px] ${o.alerte ? "bg-alerte/15 text-alerte" : "bg-surface-3"}`}>{o.compte}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * Disponibilite en barres, la plus ancienne a gauche : une barre par tranche,
 * verte a 99 % et plus (un echec isole sur une journee ne doit pas tout
 * colorer), orange a 90 %, rouge en dessous.
 * `tranches` : [{ total, ok, debut }] ; une tranche vide reste grise.
 */
export function BarresDispo({ tranches, hauteur = "h-6", titre = null }) {
  return (
    <div className="flex items-end gap-[2px]" aria-label={titre ?? "Disponibilité"}>
      {tranches.map((t, i) => {
        let classe = "bg-surface-3";
        if (t.total > 0) {
          const taux = t.ok / t.total;
          classe = taux >= 0.99 ? "bg-ok/75" : taux >= 0.9 ? "bg-alerte" : "bg-ko";
        }
        return (
          <span
            key={t.debut ?? i}
            title={t.libelle}
            className={`min-w-[2px] flex-1 rounded-[2px] ${hauteur} ${classe}`}
          />
        );
      })}
    </div>
  );
}

/**
 * Panneau lateral de saisie, par-dessus la page. Echap ou un clic sur le fond
 * le ferment ; Ctrl+Entree valide le formulaire qu'il contient.
 */
export function Tiroir({ titre, ouvert, onFermer, pied = null, children, largeur = "w-[460px]" }) {
  useEffect(() => {
    if (!ouvert) return undefined;
    const touche = (e) => {
      if (e.key === "Escape") onFermer();
    };
    window.addEventListener("keydown", touche);
    return () => window.removeEventListener("keydown", touche);
  }, [ouvert, onFermer]);

  if (!ouvert) return null;
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={titre}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onFermer} />
      <aside
        className={`absolute inset-y-0 right-0 flex max-w-full flex-col border-l border-bord bg-surface text-texte shadow-2xl ${largeur}`}
        style={{ animation: "glisser-gauche 160ms ease-out" }}
      >
        <header className="flex items-center justify-between border-b border-bord px-6 py-4">
          <h2 className="text-[15px] font-semibold">{titre}</h2>
          <button type="button" onClick={onFermer} className="rounded-md p-1 text-texte-doux hover:bg-surface-2 hover:text-texte" aria-label="Fermer">
            <X size={18} />
          </button>
        </header>
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">{children}</div>
        {pied && <footer className="flex items-center justify-end gap-2 border-t border-bord px-6 py-4">{pied}</footer>}
      </aside>
    </div>
  );
}

/**
 * Menu d'actions d'une ligne (⋯) : les actions secondaires sortent de la ligne.
 * `actions` : [{ libelle, Icone, onClick, danger, separe }].
 */
export function MenuActions({ actions, titre = "Actions" }) {
  const [ouvert, setOuvert] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!ouvert) return undefined;
    const dehors = (e) => {
      if (!ref.current?.contains(e.target)) setOuvert(false);
    };
    const echap = (e) => e.key === "Escape" && setOuvert(false);
    document.addEventListener("mousedown", dehors);
    window.addEventListener("keydown", echap);
    return () => {
      document.removeEventListener("mousedown", dehors);
      window.removeEventListener("keydown", echap);
    };
  }, [ouvert]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label={titre}
        title={titre}
        aria-expanded={ouvert}
        onClick={(e) => {
          e.stopPropagation();
          setOuvert((o) => !o);
        }}
        className={`grid size-8 place-items-center rounded-lg transition ${ouvert ? "bg-surface-3 text-texte" : "text-pale hover:bg-surface-2 hover:text-texte"}`}
      >
        <Ellipsis size={16} />
      </button>
      {ouvert && (
        <div
          role="menu"
          className="absolute top-full right-0 z-30 mt-1 w-56 rounded-xl bg-surface-2 p-1.5 text-texte shadow-2xl ring-1 ring-bord"
          style={{ animation: "apparaitre 120ms ease-out" }}
        >
          {actions.filter(Boolean).map((a) => (
            <div key={a.libelle}>
              {a.separe && <div className="my-1 h-px bg-bord" />}
              <button
                type="button"
                role="menuitem"
                disabled={a.disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  setOuvert(false);
                  a.onClick();
                }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition hover:bg-surface-3 disabled:opacity-40 ${a.danger ? "text-ko" : ""}`}
              >
                {a.Icone && <a.Icone size={14} className={a.danger ? "" : "text-texte-doux"} />}
                {a.libelle}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Selection multiple de sites, en pastilles cliquables.
 * Une depense partagee (un hebergement mutualise, par exemple) se rattache a
 * autant de sites que necessaire; son montant est ensuite reparti entre eux.
 */
export function SelecteurSites({ label, sites, selection, onBasculer, aide }) {
  return (
    <div className="flex min-w-56 flex-col gap-1.5">
      {label && <span className="text-xs font-medium text-texte-doux">{label}</span>}
      <div className="flex flex-wrap items-center gap-1.5">
        {sites.length === 0 && <span className="text-xs text-texte-doux">aucun site</span>}
        {sites.map((site) => {
          const choisi = selection.includes(site.id);
          return (
            <button
              key={site.id}
              type="button"
              onClick={() => onBasculer(site.id)}
              aria-pressed={choisi}
              className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium ring-1 transition ${
                choisi
                  ? "bg-accent/12 text-texte ring-accent"
                  : "text-texte-doux ring-bord hover:ring-accent"
              }`}
            >
              <span
                className="size-2 rounded-full"
                style={{ background: site.couleur, opacity: choisi ? 1 : 0.4 }}
              />
              {site.nom}
            </button>
          );
        })}
      </div>
      {aide && <span className="text-[11px] text-pale">{aide}</span>}
    </div>
  );
}

/**
 * Interrupteur on/off (switch), a la place d'une case a cocher. Un vrai
 * bouton `role="switch"` : clavier, lecteur d'ecran et `aria-checked` compris.
 * Avec `children`, le libelle est cliquable aussi.
 */
export function Interrupteur({ actif, onChanger, disabled = false, title, className = "", children, ...props }) {
  const bouton = (
    <button
      type="button"
      role="switch"
      aria-checked={Boolean(actif)}
      disabled={disabled}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onChanger(!actif);
      }}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-40 ${
        actif ? "border-accent bg-accent" : "border-bord bg-surface-3"
      } ${children ? "" : className}`}
      {...props}
    >
      <span
        aria-hidden="true"
        className={`inline-block size-3.5 rounded-full bg-white shadow transition-transform ${
          actif ? "translate-x-[18px]" : "translate-x-[2px]"
        }`}
      />
    </button>
  );
  if (!children) return bouton;
  return (
    <label className={`flex items-center gap-2.5 ${disabled ? "" : "cursor-pointer"} ${className}`}>
      {bouton}
      <span>{children}</span>
    </label>
  );
}

/** Couleur de la marque Claude : un passage qui a fait appel a Claude. */
export const COULEUR_CLAUDE = "#d97757";

/**
 * Logo de Claude (l'etoile a rayons), en SVG : orange si le passage a utilise
 * Claude, gris pale sinon. `titre` est l'infobulle qui dit pourquoi.
 */
export function LogoClaude({ utilise = true, taille = 14, titre, className = "" }) {
  const rayons = 12;
  return (
    <span title={titre} aria-label={titre} role="img" className={`inline-flex shrink-0 ${className}`}>
      <svg
        width={taille}
        height={taille}
        viewBox="0 0 24 24"
        aria-hidden="true"
        style={{ color: utilise ? COULEUR_CLAUDE : "var(--color-texte-doux)", opacity: utilise ? 1 : 0.35 }}
      >
        {Array.from({ length: rayons }, (_, i) => (
          <rect
            key={i}
            x="11"
            y={i % 2 ? 3.5 : 1.5}
            width="2"
            height={i % 2 ? 8.5 : 10.5}
            rx="1"
            fill="currentColor"
            transform={`rotate(${(360 / rayons) * i} 12 12)`}
          />
        ))}
      </svg>
    </span>
  );
}

/** Pied d'un historique pagine : « Afficher plus » tant qu'il reste des lignes. */
export function AfficherPlus({ affichees, total, onPlus }) {
  if (affichees >= total) return null;
  return (
    <div className="mt-3 flex justify-center">
      <Bouton variante="fantome" className="text-xs" onClick={onPlus}>
        Afficher plus ({total - affichees} restantes)
      </Bouton>
    </div>
  );
}
