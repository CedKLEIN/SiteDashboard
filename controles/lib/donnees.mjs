/**
 * Coherence des donnees des sites, en lecture seule : catalogue de Denivio,
 * souverains et contenus de HistorySite. Fonctions pures, testables.
 */

const EXEMPLES_MAX = 20;
const ALTITUDE_MAX = 4810; // Mont Blanc
const EUROPE = { latMin: 34, latMax: 72, lonMin: -25, lonMax: 45 };

/** Normalise un nom pour reperer les doublons : casse et apostrophes ’ / ' confondues. */
export function nomNormalise(nom) {
  return String(nom ?? "").toLowerCase().replace(/[’‘`]/g, "'").replace(/\s+/g, " ").trim();
}

function categorie() {
  return { nombre: 0, exemples: [] };
}

function noter(cat, exemple) {
  cat.nombre += 1;
  if (cat.exemples.length < EXEMPLES_MAX) cat.exemples.push(exemple);
}

/**
 * Analyse le seed du catalogue Denivio (tableau de lieux). Categories reprises
 * des consignes de l'agent d'audit : doublons, coordonnees en double ou hors
 * Europe, altitudes hors bornes, champs vides, noms suspects.
 */
export function analyserCatalogue(lieux) {
  const anomalies = {
    nomsEnDouble: categorie(),
    coordonneesEnDouble: categorie(),
    altitudeHorsBornes: categorie(),
    coordonneesManquantes: categorie(),
    // Information, pas une erreur : les cols d'outre-mer (Nouvelle-Caledonie,
    // Polynesie, Antilles) sont rattaches a la France
    horsEurope: categorie(),
    paysVide: categorie(),
    sourceVide: categorie(),
    typeOther: categorie(),
    nomSuspect: categorie(),
  };
  const parPays = {};
  const parType = {};
  const noms = new Map();
  const positions = new Map();

  for (const lieu of lieux) {
    const libelle = `${lieu.name} (${lieu.country || "?"})`;
    parPays[lieu.country || "(vide)"] = (parPays[lieu.country || "(vide)"] ?? 0) + 1;
    parType[lieu.featureType || "(vide)"] = (parType[lieu.featureType || "(vide)"] ?? 0) + 1;

    const cle = `${nomNormalise(lieu.name)}|${lieu.country ?? ""}`;
    if (noms.has(cle)) noter(anomalies.nomsEnDouble, libelle);
    else noms.set(cle, true);

    const { latitude: lat, longitude: lon } = lieu;
    if (typeof lat !== "number" || typeof lon !== "number") {
      noter(anomalies.coordonneesManquantes, libelle);
    } else if (lat < EUROPE.latMin || lat > EUROPE.latMax || lon < EUROPE.lonMin || lon > EUROPE.lonMax) {
      noter(anomalies.horsEurope, `${libelle} : ${lat}, ${lon}`);
    } else {
      // 5 decimales ~ 1 m
      const position = `${lat.toFixed(5)},${lon.toFixed(5)}`;
      if (positions.has(position)) noter(anomalies.coordonneesEnDouble, `${libelle} = ${positions.get(position)}`);
      else positions.set(position, libelle);
    }
    if (lieu.altitude != null && (lieu.altitude <= 0 || lieu.altitude > ALTITUDE_MAX)) {
      noter(anomalies.altitudeHorsBornes, `${libelle} : ${lieu.altitude} m`);
    }
    if (!String(lieu.country ?? "").trim()) noter(anomalies.paysVide, libelle);
    if (!String(lieu.sourceName ?? "").trim()) noter(anomalies.sourceVide, libelle);
    if (lieu.featureType === "Other") noter(anomalies.typeOther, libelle);
    if (/\d+[.,]\d{3,}|[[\]{}]|#\d+|\b(?:id|osm|node|way)\s*[:=]?\s*\d+/i.test(lieu.name ?? "")) {
      noter(anomalies.nomSuspect, libelle);
    }
  }
  return { total: lieux.length, parPays, parType, anomalies };
}

/**
 * Cles d'un objet JS litteral `export const X = { 'Nom': [...], Charlemagne: [...] }`
 * lu comme texte : entre guillemets ou nues (identifiant simple), suivies d'un tableau.
 */
export function clesObjet(source) {
  // Indentation libre (bios.js a une cle a 3 espaces) : c'est le `: [` qui filtre
  return [...source.matchAll(/^[ \t]+(?:(['"])((?:(?!\1).)+)\1|([\p{L}_$][\p{L}\p{N}_$]*))\s*:\s*\[/gmu)].map(
    (m) => m[2] ?? m[3],
  );
}

/** Valeurs de `ruler: '...'` dans un fichier de dates cles. */
export function souverainsCites(source) {
  return [...source.matchAll(/\bruler\s*:\s*(['"])((?:(?!\1).)+)\1/g)].map((m) => m[2]);
}

/**
 * Coherence des contenus de HistorySite. `souverains` : liste de l'API (prod) ;
 * `instantane` : rulers-snapshot.json (local) ; bios FR/EN, dates cles et
 * portraits lus dans le depot du front.
 */
export function analyserHistoire({ souverains, instantane, biosFr, biosEn, datesFr, datesEn, portraits, fichierExiste }) {
  const noms = new Set(souverains.map((s) => s.name));
  const nomsLocaux = new Set(instantane.map((s) => s.name));
  const ids = new Set(instantane.map((s) => s.id));
  const difference = (a, b) => [...a].filter((x) => !b.has(x));
  const fr = new Set(biosFr);
  const en = new Set(biosEn);

  return {
    total: { prod: souverains.length, local: instantane.length },
    anomalies: {
      seulementEnProd: difference(noms, nomsLocaux),
      seulementEnLocal: difference(nomsLocaux, noms),
      sansBioFr: difference(nomsLocaux, fr),
      sansBioEn: difference(nomsLocaux, en),
      bioOrpheline: [...difference(fr, nomsLocaux), ...difference(en, nomsLocaux)],
      dateCleOrpheline: [...new Set([...datesFr, ...datesEn])].filter((n) => !nomsLocaux.has(n)),
      portraitOrphelin: Object.keys(portraits).filter((n) => !nomsLocaux.has(n)),
      portraitIntrouvable: Object.entries(portraits).filter(([, p]) => p.src && !fichierExiste(p.src)).map(([n]) => n),
      regneIncoherent: instantane.filter((s) => s.startYear != null && s.endYear != null && s.endYear < s.startYear).map((s) => s.name),
      lienCasse: instantane
        .filter((s) => (s.parentId != null && !ids.has(s.parentId)) || (s.spouseId != null && !ids.has(s.spouseId)))
        .map((s) => s.name),
    },
  };
}

/**
 * Compare les categories d'anomalies a la semaine precedente : renvoie celles
 * qui ont augmente. `nombre` : un nombre ou un tableau (sa longueur compte).
 */
export function hausses(actuelles, precedentes = {}) {
  const taille = (v) => (Array.isArray(v) ? v.length : (v?.nombre ?? v ?? 0));
  return Object.entries(actuelles)
    .filter(([cle, v]) => precedentes[cle] != null && taille(v) > precedentes[cle])
    .map(([cle, v]) => ({ cle, avant: precedentes[cle], apres: taille(v) }));
}

/** Resume des tailles par categorie, pour l'etat et la comparaison suivante. */
export function tailles(anomalies) {
  return Object.fromEntries(Object.entries(anomalies).map(([cle, v]) => [cle, Array.isArray(v) ? v.length : v.nombre]));
}
