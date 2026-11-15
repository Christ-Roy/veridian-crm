// Dépendances entre tâches et ordonnancement du Gantt. Logique pure, éprouvée par `node essai-arbre.mjs`.
// Un lien dit : `tacheId` attend `prerequisId`. Les jours sont comptés en UTC, au début du jour.

export type TachePlan = {
  id: string;
  dueAt: string | null;
  status: string | null;
  suiviType: string | null;
  dureeEstimee?: number | null;
};

export type Lien = { tacheId: string | null; prerequisId: string | null };

export type Placement = {
  debut: number; // début du premier jour (ms UTC)
  fin: number; // début du dernier jour (ms UTC) ; la barre couvre [debut, fin + 1 jour)
  datee: boolean; // la tâche a une échéance ; sinon sa place est calculée
  jalon: boolean;
  jalonSansDate: boolean;
  enRetard: boolean;
  conflit: boolean; // un prérequis finit le jour de l'échéance ou après
  dansBoucle: boolean;
};

export const JOUR = 86400000;
export const debutDuJour = (ms: number): number => Math.floor(ms / JOUR) * JOUR;

// 7 heures de travail font un jour ; sans estimation, une tâche occupe un jour.
export const dureeJours = (minutes: number | null | undefined): number =>
  minutes && minutes > 0 ? Math.max(1, Math.ceil(minutes / (7 * 60))) : 1;

const attentes = (liens: Lien[], connus?: Set<string>): Map<string, string[]> => {
  const m = new Map<string, string[]>();
  for (const l of liens) {
    if (!l.tacheId || !l.prerequisId) continue;
    if (connus && (!connus.has(l.tacheId) || !connus.has(l.prerequisId))) continue;
    m.set(l.tacheId, [...(m.get(l.tacheId) ?? []), l.prerequisId]);
  }
  return m;
};

// Les tâches prises dans une boucle (composantes fortement connexes de Tarjan, ou tâche qui s'attend elle-même).
export const tachesEnBoucle = (ids: string[], liens: Lien[]): Set<string> => {
  const connus = new Set(ids);
  const graphe = attentes(liens, connus);
  const index = new Map<string, number>();
  const bas = new Map<string, number>();
  const pile: string[] = [];
  const surPile = new Set<string>();
  const resultat = new Set<string>();
  let compteur = 0;
  const visiter = (v: string) => {
    index.set(v, compteur);
    bas.set(v, compteur++);
    pile.push(v);
    surPile.add(v);
    for (const w of graphe.get(v) ?? []) {
      if (!index.has(w)) {
        visiter(w);
        bas.set(v, Math.min(bas.get(v)!, bas.get(w)!));
      } else if (surPile.has(w)) bas.set(v, Math.min(bas.get(v)!, index.get(w)!));
    }
    if (bas.get(v) === index.get(v)) {
      const composante: string[] = [];
      let w: string;
      do {
        w = pile.pop()!;
        surPile.delete(w);
        composante.push(w);
      } while (w !== v);
      if (composante.length > 1 || (graphe.get(v) ?? []).includes(v)) composante.forEach((x) => resultat.add(x));
    }
  };
  for (const v of ids) if (!index.has(v)) visiter(v);
  return resultat;
};

// Ajouter « tacheId attend prerequisId » fermerait-il une boucle ? Oui si le prérequis attend déjà (même de
// loin) la tâche, ou si c'est la même tâche.
export const creeBoucle = (liens: Lien[], tacheId: string, prerequisId: string): boolean => {
  if (tacheId === prerequisId) return true;
  const graphe = attentes(liens);
  const vus = new Set<string>();
  const aVoir = [prerequisId];
  while (aVoir.length) {
    const v = aVoir.pop()!;
    if (v === tacheId) return true;
    if (vus.has(v)) continue;
    vus.add(v);
    aVoir.push(...(graphe.get(v) ?? []));
  }
  return false;
};

// Place chaque tâche sur la frise. Datée : elle finit à son échéance et commence `durée` jours avant (ou au plus
// tôt le lendemain de ses prérequis). Sans date : elle commence le lendemain de son dernier prérequis, au plus tôt
// aujourd'hui. Un jalon daté est un point à son échéance. Un prérequis fait ne retarde rien. Les liens pris dans une
// boucle sont ignorés pour le calcul (les tâches sont marquées).
export const ordonnancer = (taches: TachePlan[], liens: Lien[], maintenant: number): Map<string, Placement> => {
  const aujourdhui = debutDuJour(maintenant);
  const parId = new Map(taches.map((t) => [t.id, t]));
  const boucle = tachesEnBoucle(taches.map((t) => t.id), liens);
  const graphe = attentes(liens, new Set(parId.keys()));
  const places = new Map<string, Placement>();
  const enCours = new Set<string>();

  const placer = (id: string): Placement => {
    const deja = places.get(id);
    if (deja) return deja;
    const t = parId.get(id)!;
    enCours.add(id);
    let finPrerequis: number | null = null;
    for (const p of graphe.get(id) ?? []) {
      if (enCours.has(p) || (boucle.has(id) && boucle.has(p))) continue;
      if (parId.get(p)?.status === 'DONE') continue;
      const fp = placer(p).fin;
      finPrerequis = finPrerequis === null ? fp : Math.max(finPrerequis, fp);
    }
    enCours.delete(id);
    const jalon = t.suiviType === 'JALON';
    const duree = (jalon ? 1 : dureeJours(t.dureeEstimee)) * JOUR;
    const echeance = t.dueAt ? Date.parse(t.dueAt) : NaN;
    let debut: number;
    let fin: number;
    let conflit = false;
    if (!Number.isNaN(echeance)) {
      fin = debutDuJour(echeance);
      debut = fin - (duree - JOUR);
      if (finPrerequis !== null) {
        conflit = finPrerequis >= fin;
        debut = Math.min(fin, Math.max(debut, finPrerequis + JOUR));
      }
    } else {
      debut = Math.max(aujourdhui, finPrerequis === null ? aujourdhui : finPrerequis + JOUR);
      fin = debut + duree - JOUR;
    }
    const datee = !Number.isNaN(echeance);
    const p: Placement = {
      debut,
      fin,
      datee,
      jalon,
      jalonSansDate: jalon && !datee,
      enRetard: datee && t.status !== 'DONE' && fin < aujourdhui,
      conflit,
      dansBoucle: boucle.has(id),
    };
    places.set(id, p);
    return p;
  };

  for (const t of taches) placer(t.id);
  return places;
};
