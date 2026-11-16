import type { Cible, StatutReunion, TranscriptEntry } from '../types/meet.types';
import { uuidDepuisGraine } from '../utils/identifiant-stable.util';
import { graphql } from './graphql';

// Les réunions Meet du CRM (objet `reunionMeet`), leurs notes et leurs enregistrements d'appel.
// Tout identifiant écrit est dérivé d'une graine : rejouer une écriture ne crée jamais de doublon.

export type Reunion = {
  id: string;
  titre: string;
  debut: string | null;
  fin: string | null;
  lienMeet: { primaryLinkUrl: string | null } | null;
  codeReunion: string | null;
  idEvenementGoogle: string | null;
  icalUid: string | null;
  participants: string | null;
  cibles: Cible[] | null;
  statut: StatutReunion;
  noteId: string | null;
  compteGoogle: string | null;
  lienEnregistrement: { primaryLinkUrl: string | null } | null;
};

const CHAMPS = `id titre debut fin lienMeet { primaryLinkUrl } codeReunion idEvenementGoogle icalUid participants cibles
  statut noteId compteGoogle lienEnregistrement { primaryLinkUrl }`;

const PAGE_MAX = 20;

export const listerReunions = async (): Promise<Reunion[]> => {
  const tout: Reunion[] = [];
  let apres: string | null = null;
  for (let page = 0; page < PAGE_MAX; page++) {
    const d: { reunionMeets: { edges: Array<{ node: Reunion }>; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } =
      await graphql('core', `query R($apres: String) { reunionMeets(first: 100, after: $apres, orderBy: [{ debut: DescNullsLast }]) {
        edges { node { ${CHAMPS} } } pageInfo { hasNextPage endCursor } } }`, { apres });
    tout.push(...d.reunionMeets.edges.map((e) => e.node));
    if (!d.reunionMeets.pageInfo.hasNextPage) break;
    apres = d.reunionMeets.pageInfo.endCursor;
  }
  return tout;
};

export const reunionsDeLaFiche = (reunions: Reunion[], cible: Cible): Reunion[] =>
  reunions.filter((r) => (r.cibles ?? []).some((c) => c.objet === cible.objet && c.id === cible.id));

export type NouvelleReunion = Omit<Reunion, 'id' | 'lienMeet' | 'lienEnregistrement' | 'statut'> & {
  lienMeet: string;
};

export const enregistrerReunion = async (r: NouvelleReunion): Promise<string> => {
  const id = await uuidDepuisGraine(`google-meet-reunion:${r.idEvenementGoogle}`);
  await graphql('core', `mutation C($data: ReunionMeetCreateInput!) { createReunionMeet(data: $data, upsert: true) { id } }`, {
    data: {
      id,
      titre: r.titre,
      debut: r.debut,
      fin: r.fin,
      lienMeet: { primaryLinkUrl: r.lienMeet, primaryLinkLabel: 'Rejoindre le Meet' },
      codeReunion: r.codeReunion,
      idEvenementGoogle: r.idEvenementGoogle,
      icalUid: r.icalUid,
      participants: r.participants,
      cibles: r.cibles,
      statut: 'PLANIFIEE',
      noteId: r.noteId,
      compteGoogle: r.compteGoogle,
    },
  });
  return id;
};

export const majReunion = async (
  id: string,
  data: { statut: StatutReunion; detailImport: string; lienEnregistrement?: string | null },
): Promise<void> => {
  await graphql('core', `mutation U($id: UUID!, $data: ReunionMeetUpdateInput!) { updateReunionMeet(id: $id, data: $data) { id } }`, {
    id,
    data: {
      statut: data.statut,
      detailImport: data.detailImport.slice(0, 2000),
      dernierEssai: new Date().toISOString(),
      ...(data.lienEnregistrement
        ? { lienEnregistrement: { primaryLinkUrl: data.lienEnregistrement, primaryLinkLabel: 'Enregistrement' } }
        : {}),
    },
  });
};

const CHAMP_CIBLE: Record<Cible['objet'], string> = {
  person: 'targetPersonId',
  company: 'targetCompanyId',
  dossier: 'targetDossierId',
};

// Note créée ou réécrite au même identifiant, puis rattachée à chaque fiche (liens eux aussi à identifiant stable).
export const ecrireNote = async (noteId: string, titre: string, markdown: string, cibles: Cible[]): Promise<void> => {
  await graphql('core', `mutation N($data: NoteCreateInput!) { createNote(data: $data, upsert: true) { id } }`, {
    data: { id: noteId, title: titre, bodyV2: { markdown } },
  });
  const uniques = Array.from(new Map(cibles.map((c) => [`${c.objet}:${c.id}`, c])).values());
  const liens = await Promise.all(
    uniques.map(async (c) => ({
      id: await uuidDepuisGraine(`google-meet-note-target:${noteId}:${c.objet}:${c.id}`),
      noteId,
      [CHAMP_CIBLE[c.objet]]: c.id,
    })),
  );
  if (liens.length > 0)
    await graphql('core', `mutation T($data: [NoteTargetCreateInput!]!) { createNoteTargets(data: $data, upsert: true) { id } }`, {
      data: liens,
    });
};

// L'événement d'agenda synchronisé par Twenty (canal Google Calendar), retrouvé par son iCalUID.
export const evenementAgenda = async (icalUid: string | null): Promise<string | null> => {
  if (!icalUid) return null;
  const d = await graphql<{ calendarEvents: { edges: Array<{ node: { id: string } }> } }>(
    'core',
    `query E($u: String!) { calendarEvents(first: 1, filter: { iCalUid: { eq: $u } }) { edges { node { id } } } }`,
    { u: icalUid },
  );
  return d.calendarEvents.edges[0]?.node.id ?? null;
};

export const ecrireEnregistrementAppel = async (champs: {
  graine: string;
  titre: string;
  statut: 'PROCESSING' | 'COMPLETED' | 'NOT_RECORDED';
  externalRecordingId: string;
  startedAt: string | null;
  endedAt: string | null;
  transcript: TranscriptEntry[];
  calendarEventId: string | null;
}): Promise<string> => {
  const id = await uuidDepuisGraine(`google-meet-call-recording:${champs.graine}`);
  await graphql('core', `mutation R($data: CallRecordingCreateInput!) { createCallRecording(data: $data, upsert: true) { id } }`, {
    data: {
      id,
      title: champs.titre,
      status: champs.statut,
      externalRecordingId: champs.externalRecordingId,
      startedAt: champs.startedAt,
      endedAt: champs.endedAt,
      ...(champs.transcript.length > 0 ? { transcript: champs.transcript } : {}),
      ...(champs.calendarEventId ? { calendarEventId: champs.calendarEventId } : {}),
    },
  });
  return id;
};
