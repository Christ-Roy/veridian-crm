// Construit l'arborescence Sujet > Sous-sujet > tâches à partir du champ SELECT « dossier » des tâches.
// Un libellé d'option « ASD / Jalons » donne le sujet « ASD » et le sous-sujet « Jalons ».
// L'ordre suit la position des options ; une tâche sans dossier (ou avec une option inconnue) va dans
// « Sans dossier / À ranger », pour que rien ne disparaisse de la vue.

export type Tache = {
  id: string;
  title: string | null;
  status: string | null;
  dueAt: string | null;
  dossier: string | null;
};

export type OptionDossier = { value: string; label: string; position: number };

export type SousDossier = { cle: string; libelle: string; taches: Tache[] };

export type Dossier = { cle: string; libelle: string; sousDossiers: SousDossier[] };

export const SANS_DOSSIER = '__SANS_DOSSIER__';
const SEPARATEUR = ' / ';

const decouper = (libelle: string): [string, string] => {
  const i = libelle.indexOf(SEPARATEUR);
  return i === -1 ? [libelle.trim(), 'Général'] : [libelle.slice(0, i).trim(), libelle.slice(i + SEPARATEUR.length).trim()];
};

const ordreTache = (a: Tache, b: Tache): number => {
  const fa = a.status === 'DONE' ? 1 : 0;
  const fb = b.status === 'DONE' ? 1 : 0;
  if (fa !== fb) return fa - fb;
  if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
  if (a.dueAt) return -1;
  if (b.dueAt) return 1;
  return (a.title ?? '').localeCompare(b.title ?? '', 'fr');
};

export const construireArbre = (taches: Tache[], options: OptionDossier[]): Dossier[] => {
  const dossiers: Dossier[] = [];
  const parSujet = new Map<string, Dossier>();
  const parValeur = new Map<string, SousDossier>();

  for (const option of [...options].sort((a, b) => a.position - b.position)) {
    const [sujet, sous] = decouper(option.label);
    let dossier = parSujet.get(sujet);
    if (!dossier) {
      dossier = { cle: `sujet:${sujet}`, libelle: sujet, sousDossiers: [] };
      parSujet.set(sujet, dossier);
      dossiers.push(dossier);
    }
    const sousDossier: SousDossier = { cle: option.value, libelle: sous, taches: [] };
    dossier.sousDossiers.push(sousDossier);
    parValeur.set(option.value, sousDossier);
  }

  const aRanger: SousDossier = { cle: SANS_DOSSIER, libelle: 'À ranger', taches: [] };
  for (const tache of taches) {
    const cible = tache.dossier ? parValeur.get(tache.dossier) : undefined;
    (cible ?? aRanger).taches.push(tache);
  }
  if (aRanger.taches.length > 0) {
    dossiers.push({ cle: `sujet:${SANS_DOSSIER}`, libelle: 'Sans dossier', sousDossiers: [aRanger] });
  }
  for (const d of dossiers) for (const s of d.sousDossiers) s.taches.sort(ordreTache);
  return dossiers;
};

export const compter = (taches: Tache[]): { ouvertes: number; total: number } => ({
  ouvertes: taches.filter((t) => t.status !== 'DONE').length,
  total: taches.length,
});
