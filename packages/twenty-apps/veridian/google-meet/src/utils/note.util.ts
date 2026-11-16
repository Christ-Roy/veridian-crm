import { formatDateHeure } from './creneau.util';

// Corps de la note « Meet · … » posée sur les fiches à la création ; le compte rendu s'y ajoute à l'import.

export type ResumeReunion = {
  titre: string;
  debut: string | null;
  fin: string | null;
  lienMeet: string | null;
  participants: string;
  compteGoogle: string | null;
};

export const titreNote = (titre: string): string => `Meet · ${titre}`;

export const markdownReunion = (r: ResumeReunion): string => {
  const duree =
    r.debut && r.fin ? Math.max(0, Math.round((Date.parse(r.fin) - Date.parse(r.debut)) / 60_000)) : null;
  const lignes = [
    `**Google Meet** · ${formatDateHeure(r.debut)}${duree !== null ? ` (${duree} min)` : ''}`,
    '',
    `- Lien : ${r.lienMeet ?? '?'}`,
    `- Invités : ${r.participants || 'aucun'}`,
  ];
  if (r.compteGoogle) lignes.push(`- Agenda : ${r.compteGoogle}`);
  return lignes.join('\n');
};

export const markdownNoteComplete = (r: ResumeReunion, compteRendu: string | null): string =>
  compteRendu ? `${markdownReunion(r)}\n\n${compteRendu}` : markdownReunion(r);
