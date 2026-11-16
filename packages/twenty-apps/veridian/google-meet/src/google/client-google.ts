import type {
  ConferenceRecord,
  DemandeMeet,
  EvenementCree,
  MeetParticipant,
  MeetRecording,
  MeetTranscript,
  MeetTranscriptEntry,
  ResultatGoogle,
  SeanceMeet,
} from '../types/meet.types';
import { classerErreurGoogle } from '../utils/erreur-google.util';
import { construireEvenement, lireEvenementCree } from '../utils/evenement-calendar.util';

// Appels à Google faits depuis le front component (worker du navigateur, CORS ouvert par Google) avec le jeton
// de la connexion Twenty, rafraîchi par le serveur à chaque lecture. Aucun code ne tourne côté serveur.

const CALENDAR = 'https://www.googleapis.com/calendar/v3';
const MEET = 'https://meet.googleapis.com/v2';
// Bornes de pagination : aucune boucle sans fin, même si Google renvoyait toujours un nextPageToken.
const PAGES_MAX = 20;
const PAGES_MAX_TRANSCRIPTION = 60;

export const appelGoogle = async <T>(jeton: string, url: string, init: RequestInit = {}): Promise<ResultatGoogle<T>> => {
  let reponse: Response;
  try {
    reponse = await fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
  } catch (e) {
    return { ok: false, statut: 0, genre: 'AUTRE', message: `réseau : ${e instanceof Error ? e.message : String(e)}` };
  }
  const texte = await reponse.text();
  let corps: unknown = null;
  try {
    corps = texte ? JSON.parse(texte) : null;
  } catch {
    corps = texte;
  }
  if (!reponse.ok) return { ok: false, statut: reponse.status, ...classerErreurGoogle(reponse.status, corps) };
  return { ok: true, donnees: corps as T };
};

export const creerEvenementMeet = async (
  jeton: string,
  demande: DemandeMeet,
  envoyerInvitations: boolean,
): Promise<ResultatGoogle<EvenementCree>> => {
  const url = `${CALENDAR}/calendars/primary/events?conferenceDataVersion=1&sendUpdates=${envoyerInvitations ? 'all' : 'none'}`;
  const r = await appelGoogle<unknown>(jeton, url, { method: 'POST', body: JSON.stringify(construireEvenement(demande)) });
  if (!r.ok) return r;
  const evenement = lireEvenementCree(r.donnees);
  if (evenement) return { ok: true, donnees: evenement };
  // Le Meet peut être encore « pending » : une relecture suffit le plus souvent.
  const relu = await appelGoogle<unknown>(jeton, `${CALENDAR}/calendars/primary/events/${encodeURIComponent(demande.idEvenement)}`);
  if (!relu.ok) return relu;
  const evenementRelu = lireEvenementCree(relu.donnees);
  return evenementRelu
    ? { ok: true, donnees: evenementRelu }
    : { ok: false, statut: 200, genre: 'AUTRE', message: 'événement créé mais sans lien Meet (réessayer dans un instant)' };
};

const listerPagine = async <T>(
  jeton: string,
  url: string,
  cle: string,
  pagesMax: number,
): Promise<ResultatGoogle<T[]>> => {
  const tout: T[] = [];
  let jetonPage = '';
  for (let page = 0; page < pagesMax; page++) {
    const sep = url.includes('?') ? '&' : '?';
    const r = await appelGoogle<Record<string, unknown>>(
      jeton,
      `${url}${sep}pageSize=100${jetonPage ? `&pageToken=${encodeURIComponent(jetonPage)}` : ''}`,
    );
    if (!r.ok) return r;
    const lot = (r.donnees?.[cle] ?? []) as T[];
    tout.push(...lot);
    jetonPage = typeof r.donnees?.nextPageToken === 'string' ? r.donnees.nextPageToken : '';
    if (!jetonPage) break;
  }
  return { ok: true, donnees: tout };
};

// Toutes les séances d'un Meet (une par ouverture de la salle), avec participants, enregistrements et transcriptions.
export const listerSeances = async (jeton: string, codeReunion: string): Promise<ResultatGoogle<SeanceMeet[]>> => {
  const filtre = encodeURIComponent(`space.meeting_code = "${codeReunion}"`);
  const conferences = await listerPagine<ConferenceRecord>(jeton, `${MEET}/conferenceRecords?filter=${filtre}`, 'conferenceRecords', PAGES_MAX);
  if (!conferences.ok) return conferences;
  const seances: SeanceMeet[] = [];
  for (const conference of conferences.donnees) {
    const base = `${MEET}/${conference.name}`;
    const participants = await listerPagine<MeetParticipant>(jeton, `${base}/participants`, 'participants', PAGES_MAX);
    if (!participants.ok) return participants;
    const enregistrements = await listerPagine<MeetRecording>(jeton, `${base}/recordings`, 'recordings', PAGES_MAX);
    if (!enregistrements.ok) return enregistrements;
    const transcriptions = await listerPagine<MeetTranscript>(jeton, `${base}/transcripts`, 'transcripts', PAGES_MAX);
    if (!transcriptions.ok) return transcriptions;
    const entrees: MeetTranscriptEntry[] = [];
    for (const t of transcriptions.donnees.filter((x) => x.state === 'FILE_GENERATED')) {
      const lot = await listerPagine<MeetTranscriptEntry>(jeton, `${MEET}/${t.name}/entries`, 'transcriptEntries', PAGES_MAX_TRANSCRIPTION);
      if (!lot.ok) return lot;
      entrees.push(...lot.donnees);
    }
    seances.push({
      conference,
      participants: participants.donnees,
      enregistrements: enregistrements.donnees,
      transcriptions: transcriptions.donnees,
      entrees,
    });
  }
  seances.sort((a, b) => (a.conference.startTime ?? '').localeCompare(b.conference.startTime ?? ''));
  return { ok: true, donnees: seances };
};
