import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { ConnexionGoogle, SeanceMeet } from '../src/types/meet.types';
import { choisirConnexion } from '../src/utils/choisir-connexion.util';
import {
  aImporter,
  DELAI_NON_TENUE_MS,
  DELAI_TRANSCRIPTION_MS,
  dureeMinutes,
  lienEnregistrement,
  markdownCompteRendu,
  statutApresImport,
  versTranscriptEntries,
} from '../src/utils/compte-rendu.util';
import { creneauParDefaut } from '../src/utils/creneau.util';
import { decouperSaisie, emailsDuChamp, normaliserEmails } from '../src/utils/emails.util';
import { classerErreurGoogle } from '../src/utils/erreur-google.util';
import { ajouterMinutes, construireEvenement, lireEvenementCree, validerDemande } from '../src/utils/evenement-calendar.util';
import { estIdEvenementValide, nouvelIdEvenement, uuidDepuisGraine } from '../src/utils/identifiant-stable.util';
import { markdownNoteComplete, titreNote } from '../src/utils/note.util';

const demande = {
  titre: '  Point projet  ',
  description: 'desc',
  date: '2026-11-17',
  heure: '23:30',
  dureeMinutes: 45,
  emails: ['a@b.fr'],
  idEvenement: 'vrdn0123abcd',
  fuseau: 'Europe/Paris',
};

describe('événement Calendar', () => {
  it('ajoute la durée en passant minuit', () => {
    assert.deepEqual(ajouterMinutes('2026-11-17', '23:30', 45), { date: '2026-11-18', heure: '00:15' });
    assert.deepEqual(ajouterMinutes('2026-12-31', '10:00', 30), { date: '2026-12-31', heure: '10:30' });
  });
  it('construit un corps avec Meet, fuseau et invités', () => {
    const c = construireEvenement(demande);
    assert.equal(c.summary, 'Point projet');
    assert.equal(c.start.dateTime, '2026-11-17T23:30:00');
    assert.equal(c.end.dateTime, '2026-11-18T00:15:00');
    assert.equal(c.start.timeZone, 'Europe/Paris');
    assert.deepEqual(c.attendees, [{ email: 'a@b.fr' }]);
    assert.equal(c.conferenceData.createRequest.conferenceSolutionKey.type, 'hangoutsMeet');
    assert.equal(c.id, 'vrdn0123abcd');
  });
  it('refuse une demande incomplète', () => {
    assert.deepEqual(validerDemande(demande), []);
    assert.equal(validerDemande({ ...demande, titre: ' ', heure: '25:00', dureeMinutes: 2 }).length, 3);
  });
  it('lit le lien et le code du Meet, ou rend null sans Meet', () => {
    const ok = lireEvenementCree({
      id: 'vrdn1',
      iCalUID: 'vrdn1@google.com',
      htmlLink: 'https://www.google.com/calendar/event?eid=x',
      start: { dateTime: '2026-11-17T10:00:00+01:00' },
      end: { dateTime: '2026-11-17T10:30:00+01:00' },
      conferenceData: { conferenceId: 'abc-defg-hij', entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' }] },
    });
    assert.equal(ok?.codeReunion, 'abc-defg-hij');
    assert.equal(ok?.lienMeet, 'https://meet.google.com/abc-defg-hij');
    assert.equal(lireEvenementCree({ id: 'vrdn1', conferenceData: { createRequest: { status: { statusCode: 'pending' } } } }), null);
    assert.equal(lireEvenementCree(null), null);
    // Un lien sans code de réunion exploitable ne permettrait jamais de retrouver le compte rendu.
    assert.equal(lireEvenementCree({ id: "vrdn1", hangoutLink: "https://meet.google.com/lookup/xyz" }), null);
  });
});

describe('adresses', () => {
  it('normalise, dédoublonne et filtre', () => {
    assert.deepEqual(normaliserEmails([' A@B.fr', 'a@b.fr', 'pas-une-adresse', null, 'c@d.com']), ['a@b.fr', 'c@d.com']);
  });
  it('lit le champ EMAILS de Twenty', () => {
    assert.deepEqual(emailsDuChamp({ primaryEmail: 'x@y.fr', additionalEmails: ['z@y.fr', 3] }), ['x@y.fr', 'z@y.fr']);
    assert.deepEqual(emailsDuChamp(null), []);
  });
  it('découpe une saisie libre et rend les refus', () => {
    assert.deepEqual(decouperSaisie('a@b.fr; c@d.fr,\nnul'), { emails: ['a@b.fr', 'c@d.fr'], refuses: ['nul'] });
  });
});

const seance = (sur: Partial<SeanceMeet> = {}): SeanceMeet => ({
  conference: { name: 'conferenceRecords/c1', startTime: '2026-11-17T09:00:00Z', endTime: '2026-11-17T09:32:00Z' },
  participants: [
    { name: 'conferenceRecords/c1/participants/p1', signedinUser: { displayName: 'Robert Brunon' } },
    { name: 'conferenceRecords/c1/participants/p2', anonymousUser: { displayName: 'Invité' } },
  ],
  enregistrements: [{ name: 'r1', state: 'FILE_GENERATED', driveDestination: { exportUri: 'https://drive.google.com/file/d/r1' } }],
  transcriptions: [{ name: 'conferenceRecords/c1/transcripts/t1', state: 'FILE_GENERATED', docsDestination: { exportUri: 'https://docs.google.com/document/d/t1' } }],
  entrees: [
    { participant: 'conferenceRecords/c1/participants/p1', text: 'Bonjour', startTime: '2026-11-17T09:00:05Z' },
    { participant: 'conferenceRecords/c1/participants/p2', text: '  ', startTime: '2026-11-17T09:00:07Z' },
    { participant: 'conferenceRecords/c1/participants/p2', text: 'Salut', startTime: '2026-11-17T09:01:00Z' },
  ],
  ...sur,
});

describe('compte rendu', () => {
  it('convertit la transcription au format Call Recording', () => {
    const e = versTranscriptEntries(seance());
    assert.equal(e.length, 2);
    assert.deepEqual(e[0], { participant: { name: 'Robert Brunon' }, words: [{ text: 'Bonjour', start_timestamp: { relative: 5 } }] });
    assert.equal(e[1].participant.name, 'Invité');
    assert.equal(e[1].words[0].start_timestamp.relative, 60);
  });
  it('mesure la durée et trouve l’enregistrement', () => {
    assert.equal(dureeMinutes(seance()), 32);
    assert.equal(dureeMinutes(seance({ conference: { name: 'c', startTime: '2026-11-17T09:00:00Z' } })), null);
    assert.equal(lienEnregistrement(seance()), 'https://drive.google.com/file/d/r1');
  });
  it('décide du statut après import', () => {
    const fin = '2026-11-17T09:30:00Z';
    const t = Date.parse(fin);
    assert.equal(statutApresImport({ seances: [], finPrevue: fin, maintenant: t - 1000 }), 'PLANIFIEE');
    assert.equal(statutApresImport({ seances: [], finPrevue: fin, maintenant: t + 1000 }), 'EN_ATTENTE');
    assert.equal(statutApresImport({ seances: [], finPrevue: fin, maintenant: t + DELAI_NON_TENUE_MS + 1 }), 'NON_TENUE');
    assert.equal(statutApresImport({ seances: [seance()], finPrevue: fin, maintenant: t + 1000 }), 'IMPORTEE');
    const enCours = seance({ conference: { name: 'c', startTime: '2026-11-17T09:00:00Z' } });
    assert.equal(statutApresImport({ seances: [enCours], finPrevue: fin, maintenant: t }), 'EN_ATTENTE');
    const sans = seance({ transcriptions: [], entrees: [] });
    const finSeance = Date.parse('2026-11-17T09:32:00Z');
    assert.equal(statutApresImport({ seances: [sans], finPrevue: fin, maintenant: finSeance + 60_000 }), 'EN_ATTENTE');
    assert.equal(statutApresImport({ seances: [sans], finPrevue: fin, maintenant: finSeance + DELAI_TRANSCRIPTION_MS + 1 }), 'SANS_TRANSCRIPTION');
    const generee = seance({ transcriptions: [{ name: 't', state: 'ENDED' }], entrees: [] });
    assert.equal(statutApresImport({ seances: [generee], finPrevue: fin, maintenant: finSeance + DELAI_TRANSCRIPTION_MS * 3 }), 'EN_ATTENTE');
  });
  it('ne retente pas une réunion close ni une réunion future', () => {
    const t = Date.parse('2026-11-17T10:00:00Z');
    assert.equal(aImporter({ statut: 'PLANIFIEE', debut: '2026-11-17T09:00:00Z' }, t), true);
    assert.equal(aImporter({ statut: 'PLANIFIEE', debut: '2026-11-17T11:00:00Z' }, t), false);
    assert.equal(aImporter({ statut: 'IMPORTEE', debut: '2026-11-17T09:00:00Z' }, t), false);
    assert.equal(aImporter({ statut: 'EN_ATTENTE', debut: null }, t), false);
  });
  it('écrit une note lisible, transcription comprise', () => {
    const md = markdownCompteRendu([seance()]);
    assert.match(md, /Durée : 32 min/);
    assert.match(md, /Participants \(2\) : Robert Brunon, Invité/);
    assert.match(md, /Enregistrement : https:\/\/drive\.google\.com\/file\/d\/r1/);
    assert.match(md, /\*\*Robert Brunon\*\* : Bonjour/);
    assert.match(markdownCompteRendu([seance({ transcriptions: [], entrees: [] })]), /Transcription : aucune/);
    const note = markdownNoteComplete(
      { titre: 'X', debut: '2026-11-17T09:00:00Z', fin: '2026-11-17T09:30:00Z', lienMeet: 'https://meet.google.com/abc-defg-hij', participants: 'a@b.fr', compteGoogle: 'r@g.com' },
      md,
    );
    assert.match(note, /17\/11\/2026 10:00 \(30 min\)/);
    assert.match(note, /Compte rendu Google Meet/);
    assert.equal(titreNote('X'), 'Meet · X');
  });
});

describe('erreurs Google', () => {
  it('ne signale la connexion en échec que sur un jeton refusé', () => {
    assert.equal(classerErreurGoogle(401, { error: { message: 'Invalid Credentials' } }).genre, 'AUTH');
    assert.equal(classerErreurGoogle(400, { error: 'invalid_grant' }).genre, 'AUTH');
    assert.equal(classerErreurGoogle(403, { error: { message: 'no', errors: [{ reason: 'insufficientPermissions' }] } }).genre, 'DROITS');
    assert.equal(classerErreurGoogle(403, { error: { errors: [{ reason: 'rateLimitExceeded' }] } }).genre, 'QUOTA');
    assert.equal(classerErreurGoogle(409, {}).genre, 'CONFLIT');
    assert.equal(classerErreurGoogle(500, 'texte').message, 'HTTP 500');
  });
});

const cx = (sur: Partial<ConnexionGoogle>): ConnexionGoogle => ({
  id: 'x',
  providerName: 'google-meet',
  handle: 'r@g.com',
  scope: 'WORKSPACE',
  userWorkspaceId: null,
  accessToken: 'jeton',
  authFailedAt: null,
  ...sur,
});

describe('choix de la connexion', () => {
  it('préfère le compte du membre au compte partagé', () => {
    const r = choisirConnexion([cx({ id: 'w' }), cx({ id: 'u', scope: 'USER', userWorkspaceId: 'm1' })], 'm1');
    assert.equal(r.etat === 'OK' && r.connexion.id, 'u');
  });
  it('ignore la connexion USER d’un autre membre', () => {
    const r = choisirConnexion([cx({ id: 'u', scope: 'USER', userWorkspaceId: 'm2' }), cx({ id: 'w' })], 'm1');
    assert.equal(r.etat === 'OK' && r.connexion.id, 'w');
  });
  it('n’utilise jamais une connexion en échec et le dit', () => {
    assert.equal(choisirConnexion([cx({ authFailedAt: '2026-11-16' })]).etat, 'A_RECONNECTER');
    assert.equal(choisirConnexion([]).etat, 'ABSENTE');
  });
});

describe('identifiants stables', () => {
  it('rend le même UUID pour la même graine, un autre sinon', async () => {
    const a = await uuidDepuisGraine('google-meet-note:vrdn1');
    assert.equal(a, await uuidDepuisGraine('google-meet-note:vrdn1'));
    assert.notEqual(a, await uuidDepuisGraine('google-meet-note:vrdn2'));
    assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('fabrique des identifiants d’événement acceptés par Google', () => {
    const id = nouvelIdEvenement();
    assert.ok(estIdEvenementValide(id), id);
    assert.notEqual(id, nouvelIdEvenement());
    assert.equal(estIdEvenementValide('AVEC-MAJ'), false);
  });
});

describe('créneau par défaut', () => {
  it('propose la demi-heure pleine suivante, heure de Paris, 15 min devant au moins', () => {
    assert.deepEqual(creneauParDefaut(Date.parse('2026-11-17T09:10:00Z')), { date: '2026-11-17', heure: '10:30' });
    assert.deepEqual(creneauParDefaut(Date.parse('2026-07-01T21:50:00Z')), { date: '2026-07-02', heure: '00:30' });
  });
});
