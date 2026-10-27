import { useState } from "react";
import { Check, Copy } from "lucide-react";
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

export function Carte({ titre, action, className = "", children }) {
  return (
    <section
      className={`rounded-xl border border-bord bg-surface p-4 shadow-sm ${className}`}
    >
      {(titre || action) && (
        <header className="mb-3 flex items-center justify-between gap-3">
          {titre && <h2 className="text-sm font-semibold text-texte">{titre}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Kpi({ libelle, valeur, detail, ton = "neutre" }) {
  const tons = {
    neutre: "text-texte",
    depense: "text-depense",
    revenu: "text-revenu",
    alerte: "text-[#fbbf24]",
  };
  return (
    <div className="rounded-xl border border-bord bg-surface p-4">
      <p className="text-xs uppercase tracking-wide text-texte-doux">{libelle}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tons[ton]}`}>{valeur}</p>
      {detail && <p className="mt-1 text-xs text-texte-doux">{detail}</p>}
    </div>
  );
}

export function Bouton({ variante = "primaire", className = "", ...props }) {
  const variantes = {
    primaire: "bg-accent text-white hover:brightness-110",
    fantome: "border border-bord text-texte-doux hover:text-texte hover:border-accent",
    danger: "text-depense hover:bg-depense/10",
  };
  return (
    <button
      type="button"
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-40 ${variantes[variante]} ${className}`}
      {...props}
    />
  );
}

export function Champ({ label, className = "", ...props }) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-xs text-texte-doux">{label}</span>
      <input
        className="rounded-lg border border-bord bg-surface-2 px-2.5 py-1.5 text-sm text-texte outline-none focus:border-accent"
        {...props}
      />
    </label>
  );
}

export function Selecteur({ label, children, className = "", ...props }) {
  return (
    <label className={`flex flex-col gap-1 ${className}`}>
      <span className="text-xs text-texte-doux">{label}</span>
      <select
        className="rounded-lg border border-bord bg-surface-2 px-2.5 py-1.5 text-sm text-texte outline-none focus:border-accent"
        {...props}
      >
        {children}
      </select>
    </label>
  );
}

export function Pastille({ couleur }) {
  return (
    <span
      className="inline-block size-2.5 shrink-0 rounded-full"
      style={{ background: couleur || "#6366f1" }}
    />
  );
}

export function EtatVide({ children }) {
  return (
    <p className="py-8 text-center text-sm text-texte-doux">{children}</p>
  );
}

/**
 * Selection multiple de sites, en pastilles cliquables.
 * Une depense partagee (un hebergement mutualise, par exemple) se rattache a
 * autant de sites que necessaire; son montant est ensuite reparti entre eux.
 */
export function SelecteurSites({ label, sites, selection, onBasculer, aide }) {
  return (
    <div className="flex min-w-56 flex-col gap-1">
      <span className="text-xs text-texte-doux">{label}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {sites.length === 0 && <span className="text-xs text-texte-doux">aucun site</span>}
        {sites.map((site) => {
          const choisi = selection.includes(site.id);
          return (
            <button
              key={site.id}
              type="button"
              onClick={() => onBasculer(site.id)}
              className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition ${
                choisi
                  ? "border-accent bg-accent/15 text-texte"
                  : "border-bord text-texte-doux hover:border-accent"
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
      {aide && <span className="text-[11px] text-texte-doux">{aide}</span>}
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
        actif ? "border-accent bg-accent" : "border-bord bg-surface-2"
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
