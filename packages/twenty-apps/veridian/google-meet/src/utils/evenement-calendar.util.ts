import type { DemandeMeet, EvenementCree } from '../types/meet.types';

// Corps d'un `events.insert` Google Calendar avec un Meet (conferenceDataVersion=1).

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;

const pad = (n: number): string => String(n).padStart(2, '0');

// Heure murale + durée, sans fuseau : Google applique `timeZone`. Le passage de minuit change la date.
export const ajouterMinutes = (date: string, heure: string, minutes: number): { date: string; heure: string } => {
  const [a, m, j] = date.split('-').map(Number);
  const [h, mi] = heure.split(':').map(Number);
  const t = new Date(Date.UTC(a, m - 1, j, h, mi) + minutes * 60_000);
  return {
    date: `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`,
    heure: `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`,
  };
};

export const validerDemande = (d: DemandeMeet): string[] => {
  const erreurs: string[] = [];
  if (!d.titre.trim()) erreurs.push('Le titre est vide.');
  if (!DATE.test(d.date)) erreurs.push('Date invalide (AAAA-MM-JJ).');
  if (!HEURE.test(d.heure)) erreurs.push('Heure invalide (HH:MM).');
  if (!Number.isInteger(d.dureeMinutes) || d.dureeMinutes < 5 || d.dureeMinutes > 480)
    erreurs.push('Durée entre 5 et 480 minutes.');
  if (d.emails.length > 100) erreurs.push('Plus de 100 participants.');
  return erreurs;
};

export type CorpsEvenement = {
  id: string;
  summary: string;
  description: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  attendees: Array<{ email: string }>;
  conferenceData: { createRequest: { requestId: string; conferenceSolutionKey: { type: 'hangoutsMeet' } } };
  guestsCanModify: false;
};

export const construireEvenement = (d: DemandeMeet): CorpsEvenement => {
  const fin = ajouterMinutes(d.date, d.heure, d.dureeMinutes);
  return {
    id: d.idEvenement,
    summary: d.titre.trim(),
    description: d.description.trim(),
    start: { dateTime: `${d.date}T${d.heure}:00`, timeZone: d.fuseau },
    end: { dateTime: `${fin.date}T${fin.heure}:00`, timeZone: d.fuseau },
    attendees: d.emails.map((email) => ({ email })),
    conferenceData: {
      createRequest: { requestId: d.idEvenement, conferenceSolutionKey: { type: 'hangoutsMeet' } },
    },
    guestsCanModify: false,
  };
};

type ReponseEvenement = {
  id?: unknown;
  iCalUID?: unknown;
  htmlLink?: unknown;
  hangoutLink?: unknown;
  start?: { dateTime?: unknown };
  end?: { dateTime?: unknown };
  conferenceData?: {
    conferenceId?: unknown;
    createRequest?: { status?: { statusCode?: unknown } };
    entryPoints?: Array<{ entryPointType?: unknown; uri?: unknown }>;
  };
};

const texte = (v: unknown): string => (typeof v === 'string' ? v : '');

// Lit la réponse de Google. Rend null si le Meet n'est pas (encore) attaché : l'événement existe alors sans lien.
export const lireEvenementCree = (brut: unknown): EvenementCree | null => {
  const r = (brut ?? {}) as ReponseEvenement;
  const video = (r.conferenceData?.entryPoints ?? []).find((e) => e.entryPointType === 'video');
  const lienMeet = texte(video?.uri) || texte(r.hangoutLink);
  const codeReunion = texte(r.conferenceData?.conferenceId) || lienMeet.split('/').pop() || '';
  if (!texte(r.id) || !lienMeet || !/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(codeReunion)) return null;
  return {
    id: texte(r.id),
    icalUid: texte(r.iCalUID),
    lienMeet,
    codeReunion,
    lienAgenda: texte(r.htmlLink),
    debut: texte(r.start?.dateTime),
    fin: texte(r.end?.dateTime),
  };
};
