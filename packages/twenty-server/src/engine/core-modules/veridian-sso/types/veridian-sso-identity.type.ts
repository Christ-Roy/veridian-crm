/*
 * Veridian CRM — module SSO clean-room (AGPLv3).
 *
 * Identité normalisée produite après validation d'une réponse IdP
 * (SAML assertion ou OIDC id_token/userinfo). Point de convergence des deux
 * protocoles avant le JIT provisioning + génération du loginToken Twenty natif.
 */
export type VeridianSsoIdentity = {
  /** Identifiant principal du user, lowercased. Requis. */
  email: string;
  firstName?: string;
  lastName?: string;
};
