// Construit l'arborescence des dossiers (objet Dossier, relation parent) et y range les tâches (relation
// `rangement`). Profondeur libre. Tri : importance, puis nom ; tâches : ouvertes d'abord, importance, échéance.
// Une tâche sans dossier (ou dont le dossier a disparu) va dans « Sans dossier » : rien ne disparaît de la vue.

import { CATEGORIES, type Categorie, categorieDe } from './categorie.util';
import { rangImportance } from './importance.util';

export type Tache = {
  id: string;
  title: string | null;
  status: string | null;
  dueAt: string | null;
  importance: string | null;
  suiviAvancement: number | null;
  rangementId: string | null;
};

export type DossierBrut = {
  id: string;
  nom: string | null;
  importance: string | null;
  categorie: string | null;
  parentId: string | null;
  societeId?: string | null;
};

export type Noeud = {
  id: string;
  nom: string;
  importance: string | null;
  categorie: string | null;
  societeId?: string | null;
  virtuel: boolean;
  enfants: Noeud[];
  taches: Tache[];
};

export const SANS_DOSSIER = '__SANS_DOSSIER__';

const parImportancePuisNom = (a: Noeud, b: Noeud) =>
  rangImportance(a.importance) - rangImportance(b.importance) || a.nom.localeCompare(b.nom, 'fr');

const ordreTache = (a: Tache, b: Tache): number => {
  const fa = a.status === 'DONE' ? 1 : 0;
  const fb = b.status === 'DONE' ? 1 : 0;
  if (fa !== fb) return fa - fb;
  const ri = rangImportance(a.importance) - rangImportance(b.importance);
  if (ri !== 0) return ri;
  if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
  if (a.dueAt) return -1;
  if (b.dueAt) return 1;
  return (a.title ?? '').localeCompare(b.title ?? '', 'fr');
};

export const construireArbre = (dossiers: DossierBrut[], taches: Tache[]): Noeud[] => {
  const noeuds = new Map<string, Noeud>();
  for (const d of dossiers) {
    noeuds.set(d.id, {
      id: d.id,
      nom: d.nom || 'Sans nom',
      importance: d.importance,
      categorie: d.categorie,
      societeId: d.societeId ?? null,
      virtuel: false,
      enfants: [],
      taches: [],
    });
  }
  const racines: Noeud[] = [];
  for (const d of dossiers) {
    const n = noeuds.get(d.id)!;
    // Un parent introuvable (ou une boucle sur soi-même) fait du dossier une racine.
    const parent = d.parentId && d.parentId !== d.id ? noeuds.get(d.parentId) : undefined;
    (parent ? parent.enfants : racines).push(n);
  }
  const orphelines: Tache[] = [];
  for (const t of taches) {
    const n = t.rangementId ? noeuds.get(t.rangementId) : undefined;
    (n ? n.taches : orphelines).push(t);
  }
  const trier = (liste: Noeud[]) => {
    liste.sort(parImportancePuisNom);
    for (const n of liste) {
      n.taches.sort(ordreTache);
      trier(n.enfants);
    }
  };
  trier(racines);
  if (orphelines.length > 0) {
    racines.push({
      id: SANS_DOSSIER,
      nom: 'Sans dossier',
      importance: null,
      categorie: null,
      virtuel: true,
      enfants: [],
      taches: orphelines.sort(ordreTache),
    });
  }
  return racines;
};

// Les dossiers racines par catégorie, dans l'ordre Client, Interne, Prospection ; chaque catégorie est
// présente même vide (on y crée son premier dossier). « Sans dossier » reste à part.
export type Section = { categorie: Categorie; racines: Noeud[] };

export const grouperParCategorie = (racines: Noeud[]): { sections: Section[]; sansDossier: Noeud | null } => {
  const sections: Section[] = CATEGORIES.map((categorie) => ({ categorie, racines: [] as Noeud[] }));
  let sansDossier: Noeud | null = null;
  for (const n of racines) {
    if (n.virtuel) sansDossier = n;
    else sections[CATEGORIES.indexOf(categorieDe(n.categorie))].racines.push(n);
  }
  return { sections, sansDossier };
};

// Avancement d'une tâche : 100 si elle est faite, sinon son « Avancement % » borné à 0..100.
export const avancementTache = (t: Tache): number =>
  t.status === 'DONE' ? 100 : Math.max(0, Math.min(100, Math.round(t.suiviAvancement ?? 0)));

export const toutesLesTaches = (n: Noeud): Tache[] => [...n.taches, ...n.enfants.flatMap(toutesLesTaches)];

// Avancement d'un dossier : moyenne de l'avancement de toutes ses tâches (sous-dossiers compris).
// null quand le dossier n'a aucune tâche : « pas de mesure », jamais 0 % par défaut.
export const avancementDossier = (n: Noeud): number | null => {
  const ts = toutesLesTaches(n);
  if (ts.length === 0) return null;
  return Math.round(ts.reduce((s, t) => s + avancementTache(t), 0) / ts.length);
};

export const compter = (taches: Tache[]): { ouvertes: number; total: number } => ({
  ouvertes: taches.filter((t) => t.status !== 'DONE').length,
  total: taches.length,
});

// Clic sur l'avancement d'une tâche : +25 %, et de 100 % on revient à 0 %.
export const avancementSuivant = (valeur: number | null): number => {
  const v = Math.max(0, Math.min(100, Math.round(valeur ?? 0)));
  return v >= 100 ? 0 : Math.min(100, Math.floor(v / 25) * 25 + 25);
};
