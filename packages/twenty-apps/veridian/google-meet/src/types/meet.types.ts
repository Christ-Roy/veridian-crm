// Types partagés de l'app. Ce fichier n'exporte que des types : il disparaît à l'exécution.

export type StatutReunion = 'PLANIFIEE' | 'EN_ATTENTE' | 'IMPORTEE' | 'SANS_TRANSCRIPTION' | 'NON_TENUE';

export type ObjetCible = 'person' | 'company' | 'dossier';

export type Cible = { objet: ObjetCible; id: string };

export type Portee = 'USER' | 'WORKSPACE';

export type ConnexionGoogle = {
  id: string;
  providerName: string;
  handle: string | null;
  scope: Portee;
  userWorkspaceId: string | null;
  accessToken: string | null;
  authFailedAt: string | null;
};

export type DemandeMeet = {
  titre: string;
  description: string;
  // Date et heure locales (Europe/Paris), saisies dans le formulaire : « 2026-11-17 », « 10:30 ».
  date: string;
  heure: string;
  dureeMinutes: number;
  emails: string[];
  idEvenement: string;
  fuseau: string;
};

export type EvenementCree = {
  id: string;
  icalUid: string;
  lienMeet: string;
  codeReunion: string;
  lienAgenda: string;
  debut: string;
  fin: string;
};

// Réponses de l'API Google Meet REST v2 (champs lus seulement).
export type ConferenceRecord = {
  name: string;
  startTime?: string;
  endTime?: string;
  space?: string;
};

export type MeetParticipant = {
  name: string;
  earliestStartTime?: string;
  latestEndTime?: string;
  signedinUser?: { user?: string; displayName?: string };
  anonymousUser?: { displayName?: string };
  phoneUser?: { displayName?: string };
};

export type MeetRecording = {
  name: string;
  state?: string;
  driveDestination?: { file?: string; exportUri?: string };
};

export type MeetTranscript = {
  name: string;
  state?: string;
  docsDestination?: { document?: string; exportUri?: string };
};

export type MeetTranscriptEntry = {
  name?: string;
  participant?: string;
  text?: string;
  startTime?: string;
  endTime?: string;
};

// Format de transcription des Call Recordings de Twenty (le même que l'app Teams).
export type TranscriptEntry = {
  participant: { name: string | null };
  words: Array<{ text: string; start_timestamp: { relative: number } }>;
};

export type SeanceMeet = {
  conference: ConferenceRecord;
  participants: MeetParticipant[];
  enregistrements: MeetRecording[];
  transcriptions: MeetTranscript[];
  entrees: MeetTranscriptEntry[];
};

export type GenreErreurGoogle = 'AUTH' | 'DROITS' | 'INTROUVABLE' | 'CONFLIT' | 'QUOTA' | 'AUTRE';

export type ResultatGoogle<T> =
  | { ok: true; donnees: T }
  | { ok: false; statut: number; genre: GenreErreurGoogle; message: string };
