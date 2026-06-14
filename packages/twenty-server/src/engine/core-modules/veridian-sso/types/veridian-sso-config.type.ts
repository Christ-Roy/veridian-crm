/*
 * Veridian CRM — module SSO clean-room (AGPLv3).
 *
 * Config IdP en clair (jamais persistée en clair : chiffrée via
 * SecretEncryptionService avant stockage). Les deux protocoles convergent
 * ensuite vers une identité normalisée (VeridianSsoIdentity).
 */

export type VeridianSamlConfig = {
  /** SSO URL de l'IdP (entryPoint) vers laquelle on redirige le user. */
  entryPoint: string;
  /** Certificat(s) X.509 de signature de l'IdP, en base64 PEM (sans header). */
  idpCert: string | string[];
  /** EntityID du Service Provider (nous). Doit matcher la config IdP. */
  issuer: string;
  /** Exiger la signature de la réponse / des assertions (recommandé). */
  wantAuthnResponseSigned?: boolean;
  wantAssertionsSigned?: boolean;
  /** Format d'identifiant NameID (défaut : emailAddress). */
  identifierFormat?: string;
  /** Attributs SAML à mapper vers l'identité (avec fallbacks raisonnables). */
  emailAttribute?: string;
  firstNameAttribute?: string;
  lastNameAttribute?: string;
};

export type VeridianOidcConfig = {
  /** URL de l'issuer OIDC (discovery .well-known/openid-configuration). */
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  /** Scopes demandés (défaut : "openid email profile"). */
  scope?: string;
  /** Claims à mapper vers l'identité (avec fallbacks raisonnables). */
  emailClaim?: string;
  firstNameClaim?: string;
  lastNameClaim?: string;
};

export type VeridianSsoConfig = VeridianSamlConfig | VeridianOidcConfig;
