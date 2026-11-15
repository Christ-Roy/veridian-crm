// Épreuve de la logique pure de l'arbre (construire-arbre.util.ts), compilée à la volée par esbuild.
// Lancer : node essai-arbre.mjs  -> code 0 si tout passe, 1 sinon. Chaque cas a été vu échouer.
import { buildSync } from 'esbuild';
import { writeFileSync } from 'node:fs';

buildSync({
  stdin: {
    contents: ['construire-arbre', 'planning', 'devis'].map((f) => `export * from './src/utils/${f}.util.ts';`).join('\n'),
    resolveDir: '.',
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  outfile: '/tmp/arbre-essai.mjs',
  logLevel: 'error',
});
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

// Ordonnancement, boucles et Gantt (planning.util.ts). « Maintenant » figé : 15/11/2026 à midi UTC.
const J = 86400000;
const NOW = Date.UTC(2026, 10, 15, 12);
const AUJ = Date.UTC(2026, 10, 15);
const P = (id, o = {}) => ({ id, dueAt: null, status: 'TODO', suiviType: 'TACHE', dureeEstimee: null, ...o });
const L = (tacheId, prerequisId) => ({ tacheId, prerequisId });
const b = m.tachesEnBoucle(['a', 'b', 'c', 's'], [L('a', 'b'), L('b', 'a'), L('c', 'a'), L('s', 's')]);
verifier('boucle a -> b -> a détectée', b.has('a') && b.has('b'));
verifier('tâche qui attend une boucle sans en faire partie : hors boucle', !b.has('c'));
verifier('tâche qui s attend elle-même : boucle', b.has('s'));
verifier('ajout qui fermerait une boucle refusé', m.creeBoucle([L('a', 'b'), L('b', 'c')], 'c', 'a') === true);
verifier('ajout sans boucle accepté', m.creeBoucle([L('a', 'b')], 'c', 'a') === false);
verifier('prérequis sur soi-même refusé', m.creeBoucle([], 'a', 'a') === true);
const pl = m.ordonnancer(
  [
    P('z', { dueAt: '2026-11-20T10:00:00Z' }),
    P('y'),
    P('x'),
    P('libre'),
    P('jalon', { suiviType: 'JALON', dueAt: '2026-11-25T00:00:00Z' }),
    P('jalonNu', { suiviType: 'JALON' }),
    P('vieux', { dueAt: '2026-11-01T00:00:00Z' }),
    P('vieuxFait', { dueAt: '2026-11-01T00:00:00Z', status: 'DONE' }),
    P('tard', { dueAt: '2026-11-18T00:00:00Z' }),
    P('apresFait'),
    P('long', { dureeEstimee: 21 * 60 }),
    P('b1'),
    P('b2'),
  ],
  [L('y', 'z'), L('x', 'y'), L('tard', 'z'), L('apresFait', 'vieuxFait'), L('b1', 'b2'), L('b2', 'b1')],
  NOW,
);
verifier('tâche sans date placée le lendemain de son prérequis daté', pl.get('y').debut === Date.UTC(2026, 10, 21));
verifier('chaîne sans dates : x après y après z', pl.get('x').debut > pl.get('y').fin && pl.get('y').debut > pl.get('z').fin);
verifier('tâche sans date ni prérequis : aujourd hui', pl.get('libre').debut === AUJ && !pl.get('libre').datee);
verifier('jalon daté : losange à son échéance', pl.get('jalon').jalon && pl.get('jalon').debut === pl.get('jalon').fin && pl.get('jalon').fin === Date.UTC(2026, 10, 25));
verifier('jalon sans date signalé', pl.get('jalonNu').jalonSansDate === true && pl.get('jalon').jalonSansDate === false);
verifier('échéance passée non faite = en retard', pl.get('vieux').enRetard === true);
verifier('échéance passée mais faite = pas en retard', pl.get('vieuxFait').enRetard === false);
verifier('prérequis fini après l échéance = conflit', pl.get('tard').conflit === true && pl.get('y').conflit === false);
verifier('prérequis fait ne retarde pas', pl.get('apresFait').debut === AUJ);
verifier('durée estimée 21 h = barre de 3 jours', pl.get('long').fin - pl.get('long').debut === 2 * J);
verifier('boucle : ordonnancement terminé, tâches marquées', pl.get('b1').dansBoucle && pl.get('b2').dansBoucle && !pl.get('x').dansBoucle);

// Devis et encaissement (devis.util.ts) : seul l'encaissé prouvé compte.
const DV = (o) => ({ id: o.numero ?? 'd', numero: 'd', montant: null, statut: 'ENVOYE', encaissement: 'NON_VERIFIE', montantEncaisse: null, dossierId: 'k', ...o });
const bil = m.bilanDevis([
  DV({ montant: 1000, encaissement: 'PARTIEL', montantEncaisse: 400, statut: 'SIGNE' }),
  DV({ montant: 500, encaissement: 'NON_VERIFIE', montantEncaisse: 500 }),
  DV({ montant: 8000, statut: 'REMPLACE', encaissement: 'AUCUN' }),
]);
verifier('encaissé = PARTIEL/TOTAL seulement, non vérifié jamais compté', bil.encaisse === 400);
verifier('montant promis sans les devis remplacés', bil.promis === 1500 && bil.nonVerifies === 1);
verifier('dossier client sans encaissé prouvé signalé', m.signalArgent('CLIENT', 0, 0) === 'CLIENT_SANS_ENCAISSEMENT');
verifier('dossier client encaissé par sa société : pas de signal', m.signalArgent('CLIENT', 0, 500) === null);
verifier('dossier prospection avec encaissé signalé', m.signalArgent('PROSPECTION', 250, 0) === 'PROSPECTION_ENCAISSEE');
verifier('dossier interne : jamais de signal', m.signalArgent('INTERNE', 0, 0) === null);
process.exit(echecs ? 1 : 0);
