import { creerEvenementMeet, listerSeances } from '../google/client-google';
import type { Cible, ConnexionGoogle, DemandeMeet, EvenementCree } from '../types/meet.types';
import {
  aImporter,
  dureeMinutes,
  lienEnregistrement,
  markdownCompteRendu,
  statutApresImport,
  versTranscriptEntries,
} from '../utils/compte-rendu.util';
import { messagePourHumain } from '../utils/erreur-google.util';
import { uuidDepuisGraine } from '../utils/identifiant-stable.util';
import { markdownNoteComplete, titreNote } from '../utils/note.util';
import { signalerEchecAuth } from './connexions';
import { personnesParEmail } from './fiches';
import { messageErreur } from './graphql';
import {
  ecrireEnregistrementAppel,
  ecrireNote,
  enregistrerReunion,
  evenementAgenda,
  majReunion,
  type Reunion,
} from './reunions';

// Les deux gestes de l'app : créer un Meet depuis une fiche, importer les comptes rendus des Meet passés.

type ConnexionOk = ConnexionGoogle & { accessToken: string };

export type ResultatCreation = { ok: true; evenement: EvenementCree } | { ok: false; message: string };

export const creerMeet = async ({
  connexion,
  demande,
  envoyerInvitations,
  cibles,
}: {
  connexion: ConnexionOk;
  demande: DemandeMeet;
  envoyerInvitations: boolean;
  cibles: Cible[];
}): Promise<ResultatCreation> => {
  const r = await creerEvenementMeet(connexion.accessToken, demande, envoyerInvitations);
  if (!r.ok) {
    if (r.genre === 'AUTH') await signalerEchecAuth(connexion.id, r.message).catch(() => undefined);
    return { ok: false, message: messagePourHumain(r.genre, r.message) };
  }
  const ev = r.donnees;
  const noteId = await uuidDepuisGraine(`google-meet-note:${ev.id}`);
  const personnes = await personnesParEmail(demande.emails);
  const toutesCibles: Cible[] = [...cibles, ...personnes.map((id) => ({ objet: 'person' as const, id }))];
  const resume = {
    titre: demande.titre,
    debut: ev.debut,
    fin: ev.fin,
    lienMeet: ev.lienMeet,
    participants: demande.emails.join(', '),
    compteGoogle: connexion.handle,
  };
  try {
    await enregistrerReunion({
      ...resume,
      codeReunion: ev.codeReunion,
      idEvenementGoogle: ev.id,
      icalUid: ev.icalUid,
      cibles: toutesCibles,
      noteId,
    });
    await ecrireNote(noteId, titreNote(demande.titre), markdownNoteComplete(resume, null), toutesCibles);
  } catch (e) {
    // Le Meet existe dans l'agenda : on le dit, avec son lien, plutôt que de laisser croire à un échec total.
    return { ok: false, message: `Meet créé (${ev.lienMeet}) mais non noté dans le CRM : ${messageErreur(e)}` };
  }
  return { ok: true, evenement: ev };
};

export type BilanImport = { tentees: number; importees: number; enAttente: number; erreurs: string[]; aReconnecter: boolean };

const importerUne = async (connexion: ConnexionOk, r: Reunion, maintenant: number): Promise<'IMPORTEE' | 'ATTENTE' | 'AUTH' | string> => {
  if (!r.codeReunion) return 'code Meet absent';
  const s = await listerSeances(connexion.accessToken, r.codeReunion);
  if (!s.ok) {
    if (s.genre === 'AUTH') {
      await signalerEchecAuth(connexion.id, s.message).catch(() => undefined);
      return 'AUTH';
    }
    await majReunion(r.id, { statut: r.statut, detailImport: messagePourHumain(s.genre, s.message) });
    return `${r.titre} : ${messagePourHumain(s.genre, s.message)}`;
  }
  const seances = s.donnees;
  const statut = statutApresImport({ seances, finPrevue: r.fin ?? new Date(maintenant).toISOString(), maintenant });
  const calendarEventId = await evenementAgenda(r.icalUid);
  for (const seance of seances) {
    const transcript = versTranscriptEntries(seance);
    await ecrireEnregistrementAppel({
      graine: seance.conference.name,
      titre: r.titre,
      statut: transcript.length > 0 ? 'COMPLETED' : seance.conference.endTime ? 'NOT_RECORDED' : 'PROCESSING',
      externalRecordingId: seance.conference.name,
      startedAt: seance.conference.startTime ?? null,
      endedAt: seance.conference.endTime ?? null,
      transcript,
      calendarEventId,
    });
  }
  if (seances.length > 0 && r.noteId) {
    const resume = {
      titre: r.titre,
      debut: r.debut,
      fin: r.fin,
      lienMeet: r.lienMeet?.primaryLinkUrl ?? null,
      participants: r.participants ?? '',
      compteGoogle: r.compteGoogle,
    };
    await ecrireNote(r.noteId, titreNote(r.titre), markdownNoteComplete(resume, markdownCompteRendu(seances)), r.cibles ?? []);
  }
  const enr = seances.map(lienEnregistrement).find((x): x is string => !!x) ?? null;
  const duree = seances.reduce((t, x) => t + (dureeMinutes(x) ?? 0), 0);
  await majReunion(r.id, {
    statut,
    detailImport: `${seances.length} séance(s), ${duree} min, ${seances.reduce((t, x) => t + x.entrees.length, 0)} répliques transcrites`,
    lienEnregistrement: enr,
  });
  return statut === 'IMPORTEE' || statut === 'SANS_TRANSCRIPTION' || statut === 'NON_TENUE' ? 'IMPORTEE' : 'ATTENTE';
};

// Importe les réunions passées non closes. Séquentiel (API REST de Twenty : 100 requêtes par minute).
export const importerComptesRendus = async (connexion: ConnexionOk, reunions: Reunion[]): Promise<BilanImport> => {
  const maintenant = Date.now();
  const bilan: BilanImport = { tentees: 0, importees: 0, enAttente: 0, erreurs: [], aReconnecter: false };
  for (const r of reunions.filter((x) => aImporter(x, maintenant))) {
    bilan.tentees++;
    try {
      const issue = await importerUne(connexion, r, maintenant);
      if (issue === 'AUTH') {
        bilan.aReconnecter = true;
        break;
      }
      if (issue === 'IMPORTEE') bilan.importees++;
      else if (issue === 'ATTENTE') bilan.enAttente++;
      else bilan.erreurs.push(issue);
    } catch (e) {
      bilan.erreurs.push(`${r.titre} : ${messageErreur(e)}`);
    }
  }
  return bilan;
};
