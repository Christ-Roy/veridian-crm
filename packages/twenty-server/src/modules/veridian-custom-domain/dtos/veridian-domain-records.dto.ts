/*
 * Veridian CRM — Custom domain (white-label) clean-room module.
 * Copyright (c) 2026-present Veridian. Licensed under AGPLv3.
 */

import { Field, ObjectType } from '@nestjs/graphql';

/**
 * Un record DNS que le client doit poser pour activer son custom domain.
 *
 * La forme est volontairement alignée sur le DTO AGPL `DomainValidRecords`
 * (`engine/core-modules/dns-manager/dtos/domain-valid-records.ts`) pour que le
 * front et les intégrations existantes restent compatibles. On ne réutilise pas
 * directement ce DTO côté GraphQL pour garder le module autoportant et 100 %
 * Veridian (pas de couplage au schéma EE-adjacent).
 */
@ObjectType('VeridianDomainRecord')
export class VeridianDomainRecord {
  /**
   * `redirection` : le CNAME de routage HTTP (domaine → cible Veridian).
   * `ssl` : un éventuel record de validation de certificat (challenge ACME).
   * Dans notre infra Traefik (ACME TLS-ALPN-01), le client n'a en général qu'un
   * seul record `redirection` à poser — le SSL est émis au handshake.
   */
  @Field(() => String)
  validationType: 'ssl' | 'redirection';

  @Field(() => String)
  type: 'cname';

  /** "pending" | "active" | "error" — statut observé de propagation. */
  @Field(() => String)
  status: string;

  /** Nom (host) du record à créer chez le client, ex. "crm.client.com". */
  @Field(() => String)
  key: string;

  /** Valeur cible du record, ex. "crm.veridian.site". */
  @Field(() => String)
  value: string;
}

/**
 * Résultat d'une opération custom domain : l'état courant + les records à poser.
 */
@ObjectType('VeridianCustomDomainResult')
export class VeridianCustomDomainResult {
  /** Le custom domain déclaré, ou null si aucun. */
  @Field(() => String, { nullable: true })
  domain: string | null;

  /** true quand le domaine résout vers notre edge ET répond en HTTPS. */
  @Field(() => Boolean)
  isEnabled: boolean;

  @Field(() => [VeridianDomainRecord])
  records: VeridianDomainRecord[];
}
