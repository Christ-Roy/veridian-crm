import type { GenreErreurGoogle } from '../types/meet.types';

// Classe une réponse d'erreur Google. AUTH seulement quand le jeton est refusé : c'est le seul cas où l'on
// signale la connexion en échec (reportAppConnectionAuthFailure), pour que Twenty propose « Reconnecter ».

type CorpsErreur = { error?: { status?: unknown; message?: unknown; errors?: Array<{ reason?: unknown }> } | string };

export const classerErreurGoogle = (statut: number, corps: unknown): { genre: GenreErreurGoogle; message: string } => {
  const c = (corps ?? {}) as CorpsErreur;
  const e = typeof c.error === 'object' && c.error !== null ? c.error : undefined;
  const message = (typeof e?.message === 'string' && e.message) || (typeof c.error === 'string' && c.error) || `HTTP ${statut}`;
  const raisons = (e?.errors ?? []).map((x) => String(x.reason ?? ''));
  if (statut === 401 || c.error === 'invalid_grant') return { genre: 'AUTH', message };
  if (statut === 403 && raisons.some((r) => /rateLimit|quota/i.test(r))) return { genre: 'QUOTA', message };
  if (statut === 429) return { genre: 'QUOTA', message };
  if (statut === 403) return { genre: 'DROITS', message };
  if (statut === 404) return { genre: 'INTROUVABLE', message };
  if (statut === 409) return { genre: 'CONFLIT', message };
  return { genre: 'AUTRE', message };
};

export const messagePourHumain = (genre: GenreErreurGoogle, message: string): string => {
  switch (genre) {
    case 'AUTH':
      return 'Google a refusé la connexion : reconnecte Google dans Réglages > Applications > Google Meet.';
    case 'DROITS':
      return `Droit manquant côté Google (${message}). Reconnecte Google en acceptant toutes les autorisations.`;
    case 'QUOTA':
      return 'Google limite le débit : réessaie dans une minute.';
    case 'INTROUVABLE':
      return `Introuvable chez Google (${message}).`;
    case 'CONFLIT':
      return 'Cet événement existe déjà dans l’agenda (double envoi évité).';
    default:
      return `Erreur Google : ${message}`;
  }
};
