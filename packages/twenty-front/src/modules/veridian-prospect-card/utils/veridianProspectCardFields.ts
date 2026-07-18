// Veridian — module AGPL (fork twentyhq/twenty). Cockpit "fiche prospect".
//
// Logique PURE (aucune dépendance React/Apollo) : gating de l'objet, noms de
// champs company, humanisation + couleur du statut tunnel, construction des
// href tel:/mailto:. Testable isolément.
//
// Le cockpit s'accroche EN TÊTE de la fiche company (cf PageLayoutRecordPageRenderer
// — Veridian PATCH INLINE) et reproduit le feeling de l'app legacy Prospection :
// téléphone en gros + appel/mail en 1 clic, statut tunnel visible, blocs compacts
// (site, effectifs, secteur/NAF, localisation, SIREN, score).

import {
  type FieldEmailsValue,
  type FieldPhonesValue,
} from '@/object-record/record-field/ui/types/FieldMetadata';

// On réutilise LA constante existante plutôt que de retaper la string, pour
// rester aligné avec la mécanique d'ouverture de fiche (veridian-record-open).
export { VERIDIAN_STATUT_COLD_CALL_FIELD } from '@/veridian-record-open/utils/buildRecordOpenInput';

/**
 * Le cockpit ne s'affiche QUE sur la fiche company (le tunnel de vente / statut
 * cold-call vit sur company). Le gating se fait DANS le composant (return null
 * sinon) — le renderer core reste agnostique de l'objet.
 */
export const VERIDIAN_PROSPECT_CARD_OBJECT = 'company' as const;

export const isVeridianProspectCardObject = (
  objectNameSingular: string,
): boolean => objectNameSingular === VERIDIAN_PROSPECT_CARD_OBJECT;

/**
 * Noms de champs company réels (vérifiés live prod via `twenty gql metadata`,
 * cf recherche archi 2026-07-18). `phones`/`emails` sont des champs person et
 * n'existent PAS sur company aujourd'hui — on les lit quand même de façon
 * défensive (le bloc se masque si le champ est absent/vide), pour rester
 * fonctionnel si un champ téléphone est ajouté à company plus tard.
 */
export const VERIDIAN_PROSPECT_CARD_FIELDS = {
  name: 'name',
  phones: 'phones',
  emails: 'emails',
  domainName: 'domainName',
  hasWebsite: 'hasWebsite',
  siteWebUrl: 'siteWebUrl',
  effectifs: 'effectifs',
  employees: 'employees',
  secteur: 'secteur',
  codeNaf: 'codeNaf',
  departement: 'departement',
  commune: 'commune',
  codePostal: 'codePostal',
  siren: 'siren',
  prospectScore: 'prospectScore',
} as const;

// ─── Statut tunnel (SELECT statutColdCall) ──────────────────────────────────

/**
 * Libellés FR des valeurs connues du SELECT `statutColdCall` (présentes en prod
 * sur company). Fallback générique pour toute valeur inconnue.
 */
const STATUT_COLD_CALL_LABELS: Record<string, string> = {
  A_APPELER: 'À appeler',
  FICHE_OUVERTE: 'Fiche ouverte',
  RAPPELER: 'À rappeler',
  EN_DISCUSSION: 'En discussion',
  QUALIFIE: 'Qualifié',
  PAS_INTERESSE: 'Pas intéressé',
  INJOIGNABLE: 'Injoignable',
};

/** Couleur (clé `themeCssVariables.color.*`) associée à chaque statut. */
const STATUT_COLD_CALL_COLORS: Record<string, string> = {
  A_APPELER: 'blue',
  FICHE_OUVERTE: 'turquoise',
  RAPPELER: 'orange',
  EN_DISCUSSION: 'purple',
  QUALIFIE: 'green',
  PAS_INTERESSE: 'red',
  INJOIGNABLE: 'gray',
};

export type VeridianStatutColdCallColor = string;

/** Humanise une valeur de SELECT (`A_APPELER` → `À appeler`, fallback propre). */
export const humanizeStatutColdCall = (
  value: string | null | undefined,
): string | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (value in STATUT_COLD_CALL_LABELS) {
    return STATUT_COLD_CALL_LABELS[value];
  }
  // Fallback : SNAKE_CASE inconnu → "Snake case".
  const words = value.toLowerCase().replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/** Clé couleur `themeCssVariables.color.*` du badge de statut (gray par défaut). */
export const statutColdCallColor = (
  value: string | null | undefined,
): VeridianStatutColdCallColor => {
  if (value !== null && value !== undefined && value in STATUT_COLD_CALL_COLORS) {
    return STATUT_COLD_CALL_COLORS[value];
  }
  return 'gray';
};

// ─── Téléphone / email (champs composites) ──────────────────────────────────

/** `true` si la valeur composite `phones` porte un numéro exploitable. */
export const hasPhone = (
  phones: FieldPhonesValue | null | undefined,
): phones is FieldPhonesValue =>
  phones !== null &&
  phones !== undefined &&
  typeof phones.primaryPhoneNumber === 'string' &&
  phones.primaryPhoneNumber.trim() !== '';

/** Numéro affichable "en gros" : `+33 6 12 34 56 78` si calling code dispo. */
export const formatPhoneDisplay = (
  phones: FieldPhonesValue | null | undefined,
): string | null => {
  if (!hasPhone(phones)) {
    return null;
  }
  const callingCode = phones.primaryPhoneCallingCode?.trim();
  const number = phones.primaryPhoneNumber.trim();
  return callingCode ? `${callingCode} ${number}` : number;
};

/** href `tel:` (E.164 sans espaces) ou null si pas de numéro. */
export const buildTelHref = (
  phones: FieldPhonesValue | null | undefined,
): string | null => {
  if (!hasPhone(phones)) {
    return null;
  }
  const callingCode = (phones.primaryPhoneCallingCode ?? '').replace(
    /[^0-9+]/g,
    '',
  );
  const number = phones.primaryPhoneNumber.replace(/[^0-9]/g, '');
  const prefix = callingCode
    ? callingCode.startsWith('+')
      ? callingCode
      : `+${callingCode}`
    : '';
  return `tel:${prefix}${number}`;
};

/** Adresse email primaire exploitable, ou null. */
export const getPrimaryEmail = (
  emails: FieldEmailsValue | null | undefined,
): string | null => {
  const primary = emails?.primaryEmail?.trim();
  return primary ? primary : null;
};

/** href `mailto:` ou null si pas d'email. */
export const buildMailtoHref = (
  emails: FieldEmailsValue | null | undefined,
): string | null => {
  const email = getPrimaryEmail(emails);
  return email ? `mailto:${email}` : null;
};

// ─── Site web ───────────────────────────────────────────────────────────────

/**
 * URL de site cliquable (http(s) garanti), depuis `domainName` (LINKS) ou le
 * fallback `siteWebUrl` (TEXT). Renvoie { url, label } ou null.
 */
export const resolveSiteWeb = (
  domainNamePrimaryUrl: string | null | undefined,
  siteWebUrl: string | null | undefined,
): { url: string; label: string } | null => {
  const raw = (domainNamePrimaryUrl ?? siteWebUrl ?? '').trim();
  if (raw === '') {
    return null;
  }
  const label = raw.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  return { url, label };
};

// ─── Localisation ───────────────────────────────────────────────────────────

/** "31210 MONTREJEAU (31)" à partir des champs company disponibles. */
export const formatLocalisation = (
  departement: string | null | undefined,
  commune: string | null | undefined,
  codePostal: string | null | undefined,
): string | null => {
  const cp = codePostal?.trim();
  const ville = commune?.trim();
  const dept = departement?.trim();
  const head = [cp, ville].filter(Boolean).join(' ');
  const parts: string[] = [];
  if (head !== '') {
    parts.push(head);
  }
  if (dept) {
    parts.push(`(${dept})`);
  }
  return parts.length > 0 ? parts.join(' ') : null;
};
