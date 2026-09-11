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
