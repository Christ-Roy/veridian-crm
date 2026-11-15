// Épreuve de la logique pure de l'arbre (construire-arbre.util.ts), compilée à la volée par esbuild.
// Lancer : node essai-arbre.mjs  -> code 0 si tout passe, 1 sinon. Chaque cas a été vu échouer.
import { buildSync } from 'esbuild';
import { writeFileSync } from 'node:fs';

buildSync({ entryPoints: ['src/utils/construire-arbre.util.ts'], bundle: true, format: 'esm', outfile: '/tmp/arbre-essai.mjs', logLevel: 'error' });
const m = await import('/tmp/arbre-essai.mjs?' + Date.now());

let echecs = 0;
const verifier = (nom, ok) => { console.log(`${ok ? 'OK  ' : 'ECHEC'} ${nom}`); if (!ok) echecs++; };

const D = (id, nom, importance, parentId = null, categorie = 'INTERNE') => ({ id, nom, importance, parentId, categorie });
const T = (id, rangementId, o = {}) => ({ id, title: id, status: 'TODO', dueAt: null, importance: 'NORMALE', suiviAvancement: 0, rangementId, ...o });

const arbre = m.construireArbre(
  [D('a', 'Zeta', 'NORMALE'), D('b', 'Alpha', 'CRITIQUE'), D('c', 'Sous', 'BASSE', 'a'), D('d', 'Boucle', 'NORMALE', 'd')],
  [T('t1', 'c', { suiviAvancement: 50 }), T('t2', 'c', { status: 'DONE' }), T('t3', 'zzz'), T('t4', 'a', { importance: 'CRITIQUE' }), T('t5', 'a')],
);
verifier('racine critique en premier', arbre[0].id === 'b');
verifier('dossier qui se désigne lui-même = racine', arbre.some((n) => n.id === 'd'));
verifier('sous-dossier rangé sous son parent', arbre.find((n) => n.id === 'a').enfants[0].id === 'c');
verifier('tâche au dossier inconnu dans Sans dossier, en dernier', arbre.at(-1).id === m.SANS_DOSSIER && arbre.at(-1).taches[0].id === 't3');
verifier('tâche critique avant normale', arbre.find((n) => n.id === 'a').taches[0].id === 't4');
const sousC = arbre.find((n) => n.id === 'a').enfants.find((n) => n.id === 'c');
verifier('avancement dossier = moyenne, faite = 100', m.avancementDossier(sousC) === 75);
verifier('avancement agrégé sur les sous-dossiers', m.avancementDossier(arbre.find((n) => n.id === 'a')) === Math.round((0 + 0 + 50 + 100) / 4));
verifier('dossier sans tâche = pas de mesure (null)', m.avancementDossier(arbre.find((n) => n.id === 'b')) === null);
verifier('palier +25 : 0 -> 25', m.avancementSuivant(0) === 25);
verifier('palier +25 : 30 -> 50', m.avancementSuivant(30) === 50);
verifier('palier +25 : 100 -> 0', m.avancementSuivant(100) === 0);
verifier('avancement borné à 100', m.avancementTache(T('x', null, { suiviAvancement: 140 })) === 100);
const arbre2 = m.construireArbre(
  [D('p', 'Prosp', 'NORMALE', null, 'PROSPECTION'), D('k', 'Client A', 'NORMALE', null, 'CLIENT'), D('x', 'Bizarre', 'NORMALE', null, 'NIMPORTE')],
  [T('o', 'inconnu')],
);
const g = m.grouperParCategorie(arbre2);
verifier('sections dans l ordre Client, Interne, Prospection', g.sections.map((x) => x.categorie).join() === 'CLIENT,INTERNE,PROSPECTION');
verifier('dossier client dans Client', g.sections[0].racines[0]?.id === 'k');
verifier('catégorie inconnue rangée dans Interne', g.sections[1].racines[0]?.id === 'x');
verifier('Sans dossier mis à part', g.sansDossier?.taches[0]?.id === 'o' && g.sections.every((x) => x.racines.every((n) => !n.virtuel)));
process.exit(echecs ? 1 : 0);
