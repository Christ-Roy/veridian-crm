import { FeatureFlagKey } from 'twenty-shared/types';

// Veridian (27/11/2026, Robert) : un espace neuf naît avec toutes les fonctions natives, sans sortie vers un tiers.
// Posés par le chemin de provisioning du Hub, après activateWorkspace (DEFAULT_FEATURE_FLAGS de l'amont reste intact).
// Espaces existants : jamais touchés.
export const VERIDIAN_NATIVE_FEATURE_FLAGS = [
  FeatureFlagKey.IS_APP_PREFERENCES_ENABLED, // préférences par utilisateur des apps (compte Meet personnel)
  FeatureFlagKey.IS_CONFIGURABLE_SEARCH_FIELDS_ENABLED, // champs de recherche réglables, locaux
  FeatureFlagKey.IS_GETTING_STARTED_ENABLED, // liste de démarrage, liens de doc cliqués par l'utilisateur seulement
  FeatureFlagKey.IS_CALENDAR_EVENT_SHARED_ACROSS_CHANNELS_ENABLED, // partage d'événements entre canaux, en base
] as const satisfies FeatureFlagKey[];

// Restent éteints, chacun avec sa raison (lu par la spec naissance-natif.veridian.spec.ts).
export const VERIDIAN_KEPT_OFF_FEATURE_FLAGS = {
  // Aucun fournisseur IA tiers (Robert) : VERIDIAN_AI_DISABLED.
  [FeatureFlagKey.IS_AI_CHAT_INBOX_ENABLED]: 'IA',
  [FeatureFlagKey.IS_AI_CHAT_COMPONENT_BUILDER_ENABLED]: 'IA',
  // Serveurs MCP configurés par l'espace : appels vers des hôtes tiers choisis par l'utilisateur.
  [FeatureFlagKey.IS_MCP_SERVERS_ENABLED]: 'sortant',
  // Code Enterprise (permissions/record-share, related-record-path, validateur RLS) : aucune clé, aucun usage.
  [FeatureFlagKey.IS_RECORD_LEVEL_SHARING_ENABLED]: 'enterprise',
  [FeatureFlagKey.IS_RELATED_RECORD_PATHS_ENABLED]: 'enterprise',
  [FeatureFlagKey.IS_ROW_LEVEL_PERMISSION_RELATION_HOP_ENABLED]: 'enterprise',
} as const satisfies Partial<Record<FeatureFlagKey, string>>;
