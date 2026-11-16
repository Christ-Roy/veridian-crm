import type { MeetParticipant, SeanceMeet, StatutReunion, TranscriptEntry } from '../types/meet.types';

// Du brut de l'API Meet au compte rendu du CRM : transcription au format Call Recording, participants, durée,
// liens, statut. Pur et testé (tests/compte-rendu.test.ts).

const HEURE_MS = 3_600_000;
// Google produit la transcription quelques minutes après la fin ; au-delà, on conclut qu'il n'y en aura pas.
export const DELAI_TRANSCRIPTION_MS = 2 * HEURE_MS;
// Sans aucune séance Meet sept jours après l'heure prévue, la réunion n'a pas eu lieu.
export const DELAI_NON_TENUE_MS = 7 * 24 * HEURE_MS;

export const nomParticipant = (p: MeetParticipant | undefined): string | null =>
  p?.signedinUser?.displayName?.trim() ||
  p?.anonymousUser?.displayName?.trim() ||
  p?.phoneUser?.displayName?.trim() ||
  null;

const ms = (iso: string | undefined): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

export const versTranscriptEntries = (seance: SeanceMeet): TranscriptEntry[] => {
  const noms = new Map(seance.participants.map((p) => [p.name, nomParticipant(p)]));
  const origine = ms(seance.conference.startTime);
  const sortie: TranscriptEntry[] = [];
  for (const e of seance.entrees) {
    const texte = (e.text ?? '').trim();
    if (!texte) continue;
    const debut = ms(e.startTime);
    const relatif = origine !== null && debut !== null ? Math.max(0, (debut - origine) / 1000) : 0;
    sortie.push({
      participant: { name: (e.participant && noms.get(e.participant)) || null },
      words: [{ text: texte, start_timestamp: { relative: relatif } }],
    });
  }
  return sortie;
};

export const dureeMinutes = (seance: SeanceMeet): number | null => {
  const a = ms(seance.conference.startTime);
  const b = ms(seance.conference.endTime);
  return a !== null && b !== null && b >= a ? Math.round((b - a) / 60_000) : null;
};

export const lienEnregistrement = (seance: SeanceMeet): string | null =>
  seance.enregistrements.find((r) => r.driveDestination?.exportUri)?.driveDestination?.exportUri ?? null;

export const lienDocTranscription = (seance: SeanceMeet): string | null =>
  seance.transcriptions.find((t) => t.docsDestination?.exportUri)?.docsDestination?.exportUri ?? null;

const transcriptionPrete = (s: SeanceMeet): boolean =>
  s.transcriptions.some((t) => t.state === 'FILE_GENERATED') && s.entrees.length > 0;

const transcriptionEnCours = (s: SeanceMeet): boolean =>
  s.transcriptions.some((t) => t.state === 'STARTED' || t.state === 'ENDED');

// Statut d'une réunion après une tentative d'import, à l'instant `maintenant`.
export const statutApresImport = ({
  seances,
  finPrevue,
  maintenant,
}: {
  seances: SeanceMeet[];
  finPrevue: string;
  maintenant: number;
}): StatutReunion => {
  const fin = ms(finPrevue) ?? maintenant;
  if (seances.length === 0) {
    if (maintenant < fin) return 'PLANIFIEE';
    return maintenant - fin > DELAI_NON_TENUE_MS ? 'NON_TENUE' : 'EN_ATTENTE';
  }
  if (seances.some((s) => !s.conference.endTime)) return 'EN_ATTENTE';
  if (seances.some(transcriptionPrete)) return 'IMPORTEE';
  if (seances.some(transcriptionEnCours)) return 'EN_ATTENTE';
  const derniereFin = Math.max(...seances.map((s) => ms(s.conference.endTime) ?? 0));
  return maintenant - derniereFin > DELAI_TRANSCRIPTION_MS ? 'SANS_TRANSCRIPTION' : 'EN_ATTENTE';
};

// Une réunion mérite une tentative si elle n'est pas close et que son heure de début est passée.
export const aImporter = (r: { statut: StatutReunion; debut: string | null }, maintenant: number): boolean => {
  if (r.statut === 'IMPORTEE' || r.statut === 'SANS_TRANSCRIPTION' || r.statut === 'NON_TENUE') return false;
  const debut = ms(r.debut ?? undefined);
  return debut !== null && debut <= maintenant;
};

const formatHeure = (iso: string | undefined): string => {
  const t = ms(iso);
  if (t === null) return '?';
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(t));
};

// Le texte transcrit dans la note est borné ; l'intégralité vit dans le Call Recording.
export const LIMITE_TRANSCRIPTION_NOTE = 20_000;

export const markdownCompteRendu = (seances: SeanceMeet[]): string => {
  const blocs: string[] = ['## Compte rendu Google Meet'];
  seances.forEach((s, i) => {
    const titre = seances.length > 1 ? `### Séance ${i + 1}` : '';
    const noms = Array.from(new Set(s.participants.map(nomParticipant).filter((n): n is string => !!n)));
    const lignes = [
      titre,
      `- Début : ${formatHeure(s.conference.startTime)}`,
      `- Durée : ${dureeMinutes(s) ?? '?'} min`,
      `- Participants (${noms.length}) : ${noms.join(', ') || 'aucun nom transmis'}`,
    ];
    const enr = lienEnregistrement(s);
    if (enr) lignes.push(`- Enregistrement : ${enr}`);
    const doc = lienDocTranscription(s);
    if (doc) lignes.push(`- Transcription (Google Docs) : ${doc}`);
    const entrees = versTranscriptEntries(s);
    if (entrees.length > 0) {
      let texte = entrees.map((e) => `**${e.participant.name ?? 'Inconnu'}** : ${e.words[0].text}`).join('\n\n');
      if (texte.length > LIMITE_TRANSCRIPTION_NOTE)
        texte = `${texte.slice(0, LIMITE_TRANSCRIPTION_NOTE)}\n\n… (suite dans l'enregistrement d'appel)`;
      lignes.push('', '#### Transcription', '', texte);
    } else {
      lignes.push('- Transcription : aucune (activer la transcription dans Meet, compte Google Workspace)');
    }
    blocs.push(lignes.filter((l, k) => l !== '' || k > 0).join('\n'));
  });
  return blocs.join('\n\n');
};
