/*
 * Veridian CRM — Custom domain (white-label) clean-room module.
 * Copyright (c) 2026-present Veridian. Licensed under AGPLv3.
 *
 * Réimplémentation clean-room de la couche de vérification de domaine que
 * Twenty EE délègue à l'API Cloudflare-for-SaaS (custom hostnames). Écrit
 * intégralement à partir du comportement observable + de NOTRE infra
 * (Traefik ACME + CNAME), sans jamais lire le code EE `dns-manager.service.ts`.
 *
 * Principe Veridian : le client pose UN CNAME `son-domaine → crm.veridian.site`.
 * Traefik (notre edge) émet le certificat ACME au premier handshake TLS. On n'a
 * donc PAS besoin de l'API custom-hostnames Cloudflare : vérifier que ça marche
 * = (a) le CNAME résout vers notre cible + (b) le HTTPS répond sur le domaine.
 */

import { Injectable, Logger } from '@nestjs/common';

import { promises as dns } from 'dns';

import {
  getVeridianCustomDomainTarget,
  VERIDIAN_CUSTOM_DOMAIN_HEALTHZ_PATH,
  VERIDIAN_CUSTOM_DOMAIN_HTTPS_PROBE_TIMEOUT_MS,
} from 'src/modules/veridian-custom-domain/constants/veridian-custom-domain.constants';
import { type VeridianDomainRecord } from 'src/modules/veridian-custom-domain/dtos/veridian-domain-records.dto';

@Injectable()
export class VeridianDnsResolverService {
  private readonly logger = new Logger(VeridianDnsResolverService.name);

  /**
   * Records DNS que le client doit poser. Pur, sans I/O — sert à afficher la
   * marche à suivre dans l'UI admin. `status` est calculé par `checkRecords`.
   */
  buildExpectedRecords(domain: string): VeridianDomainRecord[] {
    const target = getVeridianCustomDomainTarget();

    return [
      {
        validationType: 'redirection',
        type: 'cname',
        status: 'pending',
        key: this.normalize(domain),
        value: target,
      },
    ];
  }

  /**
   * Cibles CNAME résolues pour `domain` (chaîne CNAME directe). Renvoie [] si le
   * domaine n'a pas de CNAME ou n'existe pas — jamais d'exception qui remonte.
   */
  async resolveCname(domain: string): Promise<string[]> {
    try {
      const records = await dns.resolveCname(this.normalize(domain));

      return records.map((record) => record.toLowerCase().replace(/\.$/, ''));
    } catch (error) {
      // ENOTFOUND / ENODATA : le record n'est pas (encore) posé. Pas une erreur
      // applicative — c'est l'état "en attente de configuration client".
      this.logger.debug(
        `resolveCname(${domain}) failed: ${(error as Error).message}`,
      );

      return [];
    }
  }

  /**
   * Le domaine pointe-t-il vers notre edge ? On accepte un CNAME direct vers la
   * cible, ainsi qu'un CNAME vers un sous-domaine de la cible (résolution en
   * chaîne tolérée par certains DNS clients).
   */
  async isPointingToVeridian(domain: string): Promise<boolean> {
    const target = getVeridianCustomDomainTarget();
    const cnames = await this.resolveCname(domain);

    return cnames.some(
      (cname) => cname === target || cname.endsWith(`.${target}`),
    );
  }

  /**
   * Le domaine répond-il réellement en HTTPS sur notre edge ? Handshake réel sur
   * `/healthz` avec timeout court. Prouve que Traefik route le host + sert un
   * certificat valide (donc l'ACME a abouti). C'est la preuve "ça marche".
   */
  async isHttpsReachable(domain: string): Promise<boolean> {
    const normalized = this.normalize(domain);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      VERIDIAN_CUSTOM_DOMAIN_HTTPS_PROBE_TIMEOUT_MS,
    );

    try {
      const response = await fetch(
        `https://${normalized}${VERIDIAN_CUSTOM_DOMAIN_HEALTHZ_PATH}`,
        {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
        },
      );

      // 2xx = sain. On reste strict : un 5xx ou une erreur TLS = pas prêt.
      return response.ok;
    } catch (error) {
      this.logger.debug(
        `isHttpsReachable(${domain}) failed: ${(error as Error).message}`,
      );

      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Équivalent observable du `isHostnameWorking` EE : le domaine est considéré
   * actif ssi il pointe vers nous ET répond en HTTPS.
   */
  async isHostnameWorking(domain: string): Promise<boolean> {
    const [pointing, reachable] = await Promise.all([
      this.isPointingToVeridian(domain),
      this.isHttpsReachable(domain),
    ]);

    return pointing && reachable;
  }

  /**
   * Records enrichis du statut observé (pour l'UI admin). `active` quand tout
   * marche, `pending` quand le CNAME n'est pas (encore) propagé/servi.
   */
  async checkRecords(domain: string): Promise<VeridianDomainRecord[]> {
    const records = this.buildExpectedRecords(domain);
    const working = await this.isHostnameWorking(domain);

    return records.map((record) => ({
      ...record,
      status: working ? 'active' : 'pending',
    }));
  }

  private normalize(domain: string): string {
    return domain.trim().toLowerCase().replace(/\.$/, '');
  }
}
