import { useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Bouton } from "./ui";
import { formaterRapport } from "../lib/rapport";

function Tableau({ titre, entrees }) {
  if (!entrees || entrees.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-texte-doux">
        {titre}
      </p>
      <div className="overflow-x-auto rounded-lg bg-fond">
        <table className="w-full text-[11px]">
          <tbody>
            {entrees.map(([nom, valeur], i) => (
              <tr key={`${nom}-${i}`} className="border-b border-bord/30 last:border-0">
                <td className="w-48 px-2 py-1 align-top text-texte-doux">{nom}</td>
                <td className="px-2 py-1 break-all">{valeur}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * Tout ce qui explique un echec de check: requete envoyee, redirections,
 * reponse complete, certificat et corps - avec copie en un clic.
 */
export default function Diagnostic({ check, inspection, site, enCours, onFermer }) {
  const [copie, setCopie] = useState(false);

  async function copier() {
    await writeText(formaterRapport({ check, inspection, site }));
    setCopie(true);
    setTimeout(() => setCopie(false), 2000);
  }

  const html = inspection?.content_type?.includes("html");
  const attendu = check?.doit_contenir;
  const cert = inspection?.certificat;

  return (
    <div className="rounded-xl border border-accent/40 bg-surface-2/60 p-3">
      <div className="mb-3 flex items-center gap-2">
        <h3 className="text-sm font-semibold">Diagnostic — {check.libelle}</h3>
        <span className="truncate text-xs text-texte-doux">{check.url}</span>
        <Bouton
          variante="fantome"
          className="ml-auto flex items-center gap-1.5 px-2 py-1 text-xs"
          onClick={copier}
          disabled={enCours}
        >
          {copie ? <Check size={13} /> : <Copy size={13} />}
          {copie ? "Copie !" : "Copier le rapport"}
        </Bouton>
        <Bouton variante="fantome" className="px-1.5 py-1" onClick={onFermer}>
          <X size={14} />
        </Bouton>
      </div>

      {enCours && <p className="py-3 text-sm text-texte-doux">Interrogation en cours...</p>}

      {!enCours && inspection && (
        <div className="flex flex-col gap-3">
          {inspection.erreur && <p className="text-sm text-depense">{inspection.erreur}</p>}

          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-texte-doux">Statut</dt>
              <dd className="tabular-nums">
                {inspection.statut ?? "—"} {inspection.statut_texte}
              </dd>
            </div>
            <div>
              <dt className="text-texte-doux">Content-Type</dt>
              <dd className="truncate" title={inspection.content_type ?? ""}>
                {inspection.content_type ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-texte-doux">Taille</dt>
              <dd className="tabular-nums">{inspection.taille ?? "—"} o</dd>
            </div>
            <div>
              <dt className="text-texte-doux">Durée</dt>
              <dd className="tabular-nums">{inspection.duree_ms} ms</dd>
            </div>
          </dl>

          {attendu && html && (
            <p className="rounded-lg bg-surface px-2.5 py-2 text-xs text-texte-doux">
              Le serveur répond du <strong className="text-texte">HTML</strong> sur une URL qui
              devrait servir autre chose. Soit le fichier n&apos;existe pas (regarde le statut),
              soit un repli SPA sert <code>index.html</code> pour toute URL inconnue.
            </p>
          )}

          <Tableau titre="Requête envoyée" entrees={inspection.entetes_requete} />

          {inspection.redirections?.length > 0 && (
            <Tableau
              titre="Redirections suivies"
              entrees={inspection.redirections.map((r, i) => [`saut ${i + 1}`, r])}
            />
          )}

          <Tableau titre="En-têtes de réponse" entrees={inspection.entetes_reponse} />

          {cert && !cert.erreur && (
            <Tableau
              titre="Certificat TLS"
              entrees={[
                ["jours restants", String(cert.jours_restants)],
                ["expire le", cert.expire_le ?? "—"],
                ["émetteur", cert.emetteur ?? "—"],
              ]}
            />
          )}

          <div>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-texte-doux">
              Corps de la réponse
              {inspection.tronque && <span className="normal-case"> (tronqué)</span>}
            </p>
            <pre className="max-h-64 overflow-auto rounded-lg bg-fond p-2.5 text-[11px] leading-relaxed text-texte-doux">
              {inspection.extrait || "(vide)"}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
