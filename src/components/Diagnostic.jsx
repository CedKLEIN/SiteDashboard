import { X } from "lucide-react";
import { Bouton } from "./ui";

/**
 * Ce que le serveur a REELLEMENT renvoye pour une URL surveillee.
 *
 * "fragment absent" ne dit pas si la page est vide, si c'est une erreur
 * deguisee en 200, ou si un SPA a servi son index.html pour une URL inconnue.
 * Le content-type et le debut du corps repondent en un coup d'oeil.
 */
export default function Diagnostic({ check, inspection, enCours, onFermer }) {
  const html = inspection?.content_type?.includes("html");
  const attendu = check?.doit_contenir;

  return (
    <div className="rounded-xl border border-accent/40 bg-surface-2/60 p-3">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold">Diagnostic — {check.libelle}</h3>
        <span className="truncate text-xs text-texte-doux">{check.url}</span>
        <Bouton variante="fantome" className="ml-auto px-1.5 py-1" onClick={onFermer}>
          <X size={14} />
        </Bouton>
      </div>

      {enCours && <p className="py-3 text-sm text-texte-doux">Interrogation en cours...</p>}

      {!enCours && inspection && (
        <div className="flex flex-col gap-2">
          {inspection.erreur ? (
            <p className="text-sm text-depense">{inspection.erreur}</p>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
                <div>
                  <dt className="text-texte-doux">Statut</dt>
                  <dd className="tabular-nums">{inspection.statut}</dd>
                </div>
                <div>
                  <dt className="text-texte-doux">Content-Type</dt>
                  <dd className="truncate" title={inspection.content_type ?? ""}>
                    {inspection.content_type ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-texte-doux">Taille</dt>
                  <dd className="tabular-nums">{inspection.taille} o</dd>
                </div>
                <div>
                  <dt className="text-texte-doux">Fragment attendu</dt>
                  <dd className="truncate">{attendu ?? "aucun"}</dd>
                </div>
              </dl>

              {inspection.url_finale && inspection.url_finale !== check.url && (
                <p className="text-xs text-texte-doux">
                  Redirige vers <span className="text-texte">{inspection.url_finale}</span>
                </p>
              )}

              {attendu && html && (
                <p className="rounded-lg bg-surface px-2.5 py-2 text-xs text-texte-doux">
                  Le serveur repond du <strong className="text-texte">HTML</strong> sur une URL
                  qui devrait servir autre chose. C&apos;est la signature d&apos;un repli SPA :
                  nginx sert <code>index.html</code> pour toute URL inconnue, donc le fichier
                  attendu n&apos;existe probablement pas a cette adresse.
                </p>
              )}

              <pre className="max-h-64 overflow-auto rounded-lg bg-fond p-2.5 text-[11px] leading-relaxed text-texte-doux">
                {inspection.extrait || "(corps vide)"}
              </pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
