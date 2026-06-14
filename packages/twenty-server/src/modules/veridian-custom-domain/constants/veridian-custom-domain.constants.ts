/*
 * Veridian CRM — Custom domain (white-label) clean-room module.
 * Copyright (c) 2026-present Veridian. Licensed under AGPLv3.
 *
 * Réimplémentation clean-room de la feature "custom domain" de Twenty (EE).
 * Aucun fichier `/* @license Enterprise *​/` n'a été lu ni copié pour produire
 * ce module — le comportement observable a été reconstitué depuis le code AGPL
 * (workspace-domains routing, public-domain, DTO DomainValidRecords) et adapté
 * à NOTRE infra Traefik + Cloudflare. Réf : docs/spec/CLEANROOM-CUSTOM-DOMAIN.md.
 */

/**
 * Cible CNAME par défaut que le client doit pointer pour activer son custom
 * domain. C'est l'edge Traefik prod de Veridian CRM : Traefik émet le
 * certificat ACME (TLS-ALPN-01) au premier handshake, et le serveur applicatif
 * résout le workspace par `workspace.customDomain` (routing AGPL natif).
 *
 * Surchargeable via l'env `VERIDIAN_CUSTOM_DOMAIN_TARGET` (ex. en staging :
 * `crm.staging.veridian.site`).
 */
export const DEFAULT_VERIDIAN_CUSTOM_DOMAIN_TARGET = 'crm.veridian.site';

/**
 * Lit la cible CNAME effective (env > défaut). Lecture brute de `process.env`
 * volontaire : c'est une constante d'infra, pas une config produit — on évite
 * d'alourdir `config-variables.ts` (et de risquer le patch-survival Veridian).
 */
export const getVeridianCustomDomainTarget = (): string => {
  const fromEnv = process.env.VERIDIAN_CUSTOM_DOMAIN_TARGET?.trim();

  return fromEnv && fromEnv.length > 0
    ? fromEnv.toLowerCase()
    : DEFAULT_VERIDIAN_CUSTOM_DOMAIN_TARGET;
};

/**
 * Timeout (ms) du handshake HTTPS de vérification. Court volontairement : on
 * teste juste que Traefik répond + sert un cert sur le domaine client.
 */
export const VERIDIAN_CUSTOM_DOMAIN_HTTPS_PROBE_TIMEOUT_MS = 5000;

/**
 * Chemin sondé pour prouver que le CRM répond sur le domaine client. `/healthz`
 * est le endpoint santé exposé par le serveur (gate Docker + smoke CI).
 */
export const VERIDIAN_CUSTOM_DOMAIN_HEALTHZ_PATH = '/healthz';
