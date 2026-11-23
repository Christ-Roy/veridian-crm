import { createHmac, randomUUID, timingSafeEqual } from 'crypto';

// Veridian (23/11/2026, VER-203) : chaque appel au modèle vers le fournisseur « Veridian » (le Hub) porte une
// assertion d'identité signée, pour que le Hub route vers le moteur de CET utilisateur. Twenty n'envoie sinon que la
// clé statique de l'instance. Clé dédiée (VERIDIAN_IA_IDENTITE_SECRET, Variable Nomad), jamais un secret déjà employé.
//
// Les call sites ne changent pas : buildAiTelemetry pose un en-tête de CONTEXTE interne (espace, membre, fil) ; le
// middleware du fournisseur le retire toujours (il ne sort jamais du serveur) et, pour le seul fournisseur Veridian,
// le remplace par l'assertion signée.

export const EN_TETE_CONTEXTE_IA = 'x-veridian-ia-contexte';
export const EN_TETE_IDENTITE_IA = 'x-veridian-ia-identite';
export const ISSUER_IDENTITE_IA = 'veridian-crm';
// Contrat du Hub (veridian-hub/docs/MON-IA.md, « Le fournisseur Veridian ») : aud = la base de son point d'accès.
export const AUDIENCE_IDENTITE_IA = 'https://app.veridian.site/api/ia/v1';
// fil : [A-Za-z0-9_-]{1,128}, jamais vide ; un appel sans fil (génération ponctuelle) prend un fil fixe.
const FIL_PONCTUEL = 'ponctuel';
const FIL_VALIDE = /^[A-Za-z0-9_-]{1,128}$/;
const DUREE_S = 60;

export type ContexteIa = { workspaceId: string; userWorkspaceId: string | null; fil: string };
export type ClaimsIdentiteIa = {
  iss: string;
  aud: string;
  workspace_id: string;
  hub_user_id: string | null;
  fil: string;
  iat: number;
  exp: number;
  jti: string;
};

const b64url = (texte: string | Buffer) => Buffer.from(texte).toString('base64url');

export const encoderContexteIa = (c: {
  workspaceId?: string;
  userWorkspaceId?: string | null;
  threadId?: string;
  agentId?: string | null;
}): Record<string, string> =>
  c.workspaceId
    ? {
        [EN_TETE_CONTEXTE_IA]: b64url(
          JSON.stringify({ workspaceId: c.workspaceId, userWorkspaceId: c.userWorkspaceId ?? null, fil: c.threadId ?? c.agentId ?? FIL_PONCTUEL }),
        ),
      }
    : {};

export const decoderContexteIa = (valeur: string | undefined): ContexteIa | null => {
  if (!valeur) return null;
  try {
    const c = JSON.parse(Buffer.from(valeur, 'base64url').toString('utf8'));

    return typeof c?.workspaceId === 'string'
      ? { workspaceId: c.workspaceId, userWorkspaceId: c.userWorkspaceId ?? null, fil: typeof c.fil === 'string' && FIL_VALIDE.test(c.fil) ? c.fil : FIL_PONCTUEL }
      : null;
  } catch {
    return null;
  }
};

const signature = (secret: string, signe: string) => createHmac('sha256', secret).update(signe).digest();

export const signerIdentiteIa = (
  secret: string,
  c: { workspaceId: string; hubUserId: string | null; fil: string },
  maintenantMs = Date.now(),
): string => {
  const iat = Math.floor(maintenantMs / 1000);
  const claims: ClaimsIdentiteIa = {
    iss: ISSUER_IDENTITE_IA,
    aud: AUDIENCE_IDENTITE_IA,
    workspace_id: c.workspaceId,
    hub_user_id: c.hubUserId,
    fil: c.fil,
    iat,
    exp: iat + DUREE_S,
    jti: randomUUID(),
  };
  const signe = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`;

  return `${signe}.${b64url(signature(secret, signe))}`;
};

export type VerdictIdentiteIa = { ok: true; claims: ClaimsIdentiteIa } | { ok: false; raison: string };

// Vérificateur de référence, que le Hub reprend à l'identique (MON-IA.md). Le rejeu (jti) se tient côté Hub.
export const verifierIdentiteIa = (
  jeton: string | undefined,
  secret: string,
  attendu: { workspaceId?: string; maintenantMs?: number } = {},
): VerdictIdentiteIa => {
  if (!jeton) return { ok: false, raison: 'en-tête absent' };
  const parties = jeton.split('.');

  if (parties.length !== 3) return { ok: false, raison: 'jeton illisible' };
  const [h, c, s] = parties;
  const attendue = signature(secret, `${h}.${c}`);
  const recue = Buffer.from(s, 'base64url');

  if (recue.length !== attendue.length || !timingSafeEqual(recue, attendue)) return { ok: false, raison: 'signature fausse' };
  let claims: ClaimsIdentiteIa;

  try {
    if (JSON.parse(Buffer.from(h, 'base64url').toString('utf8')).alg !== 'HS256') return { ok: false, raison: 'algorithme refusé' };
    claims = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, raison: 'jeton illisible' };
  }
  const maintenantS = Math.floor((attendu.maintenantMs ?? Date.now()) / 1000);

  if (claims.iss !== ISSUER_IDENTITE_IA || claims.aud !== AUDIENCE_IDENTITE_IA) return { ok: false, raison: 'émetteur ou audience refusés' };
  if (typeof claims.exp !== 'number' || claims.exp <= maintenantS || claims.exp - claims.iat > DUREE_S) return { ok: false, raison: 'expiré' };
  if (typeof claims.jti !== 'string' || claims.jti.length === 0) return { ok: false, raison: 'jti absent' };
  if (typeof claims.workspace_id !== 'string') return { ok: false, raison: 'workspace absent' };
  if (typeof claims.fil !== 'string' || !FIL_VALIDE.test(claims.fil)) return { ok: false, raison: 'fil invalide' };
  if (attendu.workspaceId !== undefined && claims.workspace_id !== attendu.workspaceId) return { ok: false, raison: 'workspace qui ne correspond pas' };

  return { ok: true, claims };
};
