// Veridian tunnel-de-vente — présentation des events de timeline custom.
//
// Le bridge réconciliateur (veridian-tunnel-de-vente/bridge) écrit dans la
// table `timelineActivity` des events dont le `name` est namespacé
// `email.*` / `audit.* / `score.*` (contrat CONTRATS-TUNNEL.md §4c.3). Ces
// events n'ont PAS de `linkedObjectMetadataId` (écriture REST directe), donc
// le routing natif de Twenty (par `linkedObjectMetadataItem.nameSingular`)
// les envoie sur `EventRowMainObject` qui ne sait rendre que
// created/updated/deleted/restored → ligne vide + icône « 123 ».
//
// Ce module fournit la logique PURE de présentation (sans React) : détection
// d'un event tunnel, libellé FR lisible par un commercial, et clé d'icône.
// Le rendu React vit dans ../components.

/**
 * Préfixes namespacés gérés par le rendu tunnel. Doit rester aligné sur le
 * regex des early-checks patchés inline (EventRowDynamicComponent /
 * EventIconDynamicComponent) ET sur le filtre de snapshot E2E
 * (crm-assertions.mjs `/^(email|audit|score)\./`).
 */
export const VERIDIAN_TUNNEL_EVENT_PREFIX = /^(email|audit|score)\./;

export const isVeridianTunnelEvent = (eventName: string | undefined): boolean =>
  VERIDIAN_TUNNEL_EVENT_PREFIX.test(eventName ?? '');

/**
 * Clés d'icône abstraites — résolues en composants Tabler côté React. On ne
 * référence ici que des icônes présentes dans la liste curée
 * `twenty-ui` TablerIcons.ts (aucun patch de cette liste requis).
 */
export type VeridianTunnelIconKey =
  | 'send'
  | 'eye'
  | 'click'
  | 'mailX'
  | 'unsubscribe'
  | 'pageView'
  | 'scroll'
  | 'cta'
  | 'rdv'
  | 'score'
  | 'generic';

type VeridianTunnelPresentation = {
  /** Libellé court affiché dans la timeline, en français, orienté commercial. */
  label: string;
  /** Clé d'icône abstraite (résolue en composant Tabler côté React). */
  icon: VeridianTunnelIconKey;
};

// Table de correspondance event.name → présentation. Les noms d'events sont
// FIGÉS par le contrat §4c.3 ; une nouvelle entrée ici suit l'ajout d'un nom
// d'event côté bridge.
const PRESENTATIONS: Record<string, VeridianTunnelPresentation> = {
  // Notifuse (relai self-hosted) — §4c.3 / §7a
  'email.sent': { label: `Email envoyé`, icon: 'send' },
  'email.opened': { label: `A ouvert l'email`, icon: 'eye' },
  'email.clicked': { label: `A cliqué le lien`, icon: 'click' },
  'email.bounced': { label: `Email rejeté (bounce)`, icon: 'mailX' },
  'email.unsubscribed': { label: `S'est désinscrit`, icon: 'unsubscribe' },
  // Analytics (parcours site audit) — §4a / §4c.3
  'audit.page_view': { label: `A visité sa page audit`, icon: 'pageView' },
  'audit.scroll': { label: `A scrollé sa page audit`, icon: 'scroll' },
  'audit.cta_click': { label: `A cliqué le CTA rendez-vous`, icon: 'cta' },
  'audit.rdv': { label: `A pris rendez-vous`, icon: 'rdv' },
  // Jalon de scoring — §4c.4
  'score.threshold': { label: `Palier de score franchi`, icon: 'score' },
};

// Libellés de repli par namespace, pour qu'un nouvel event tunnel non encore
// cartographié reste lisible (jamais de ligne vide / d'icône « 123 »).
const NAMESPACE_FALLBACK: Record<string, VeridianTunnelPresentation> = {
  email: { label: `Événement email`, icon: 'send' },
  audit: { label: `Activité sur la page audit`, icon: 'pageView' },
  score: { label: `Mise à jour du score`, icon: 'score' },
};

/**
 * Présentation d'un event tunnel : libellé FR + clé d'icône. Tolérant :
 * - nom exact connu → libellé dédié ;
 * - nom inconnu mais namespace tunnel → repli par namespace ;
 * - sinon (ne devrait pas arriver, l'appelant garde déjà via isVeridianTunnelEvent)
 *   → générique.
 */
export const getVeridianTunnelPresentation = (
  eventName: string,
): VeridianTunnelPresentation => {
  const exact = PRESENTATIONS[eventName];
  if (exact) {
    return exact;
  }
  const [namespace] = eventName.split('.');
  return (
    NAMESPACE_FALLBACK[namespace] ?? {
      label: eventName,
      icon: 'generic',
    }
  );
};

/**
 * Détails discrets affichables sous le libellé (batchId, messageId, url, …).
 * On lit `properties` de façon défensive (le payload vient d'une écriture REST
 * externe). On ne montre QUE des clés métier utiles au commercial / au debug,
 * jamais le payload brut entier.
 *
 * `eventId`/`source` sont la trace d'audit du writer (SPEC-BRIDGE §4.3) :
 * utiles pour repérer un doublon à l'œil, gardés en dernier.
 */
export const getVeridianTunnelDetails = (
  properties: unknown,
): { key: string; label: string; value: string }[] => {
  if (properties == null || typeof properties !== 'object') {
    return [];
  }
  const p = properties as Record<string, unknown>;
  const details: { key: string; label: string; value: string }[] = [];

  const pushIf = (key: string, label: string) => {
    const raw = p[key];
    if (raw == null) {
      return;
    }
    if (typeof raw === 'object') {
      return;
    }
    const value = String(raw).trim();
    if (value.length === 0) {
      return;
    }
    details.push({ key, label, value });
  };

  pushIf('url', `URL`);
  pushIf('cta', `CTA`);
  pushIf('depth', `Profondeur`);
  pushIf('threshold', `Palier`);
  pushIf('score', `Score`);
  pushIf('batchId', `Batch`);
  pushIf('broadcastId', `Diffusion`);
  pushIf('messageId', `Message`);
  pushIf('eventId', `Event ID`);
  pushIf('source', `Source`);

  return details;
};

/**
 * Heure réelle de l'event. Le bridge pose `happensAt` (ISO UTC = timestamp
 * VRAI de l'event, jamais l'heure d'écriture — SPEC-BRIDGE §4). La timeline
 * native groupe/affiche par `createdAt` (l'INSERT) ; pour les events tunnel on
 * préfère `happensAt` quand il est présent et parseable.
 */
export const getVeridianTunnelHappensAt = (event: {
  happensAt?: string | null;
  createdAt?: string | null;
}): string | undefined => {
  const candidate = event.happensAt ?? undefined;
  if (candidate && !Number.isNaN(Date.parse(candidate))) {
    return candidate;
  }
  return event.createdAt ?? undefined;
};
