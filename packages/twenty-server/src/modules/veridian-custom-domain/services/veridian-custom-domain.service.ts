/*
 * Veridian CRM — Custom domain (white-label) clean-room module.
 * Copyright (c) 2026-present Veridian. Licensed under AGPLv3.
 *
 * Orchestration du custom domain : déclaration, vérification, retrait. Écrit les
 * colonnes `customDomain` + `isCustomDomainEnabled` de l'entité AGPL
 * `WorkspaceEntity` — c'est exactement ce que le routing AGPL natif
 * (`resolveWorkspaceAndPublicDomain`, where:{customDomain}) lit pour router une
 * requête vers le bon workspace. On vit donc EN PARALLÈLE du chemin Twenty natif
 * (gated EE, inactif sans clé), pas en surcharge : zéro modification d'un fichier
 * existant, zéro migration (les colonnes existent déjà).
 *
 * La couche de vérification DNS/HTTPS est notre `VeridianDnsResolverService`
 * (clean-room), substitué au `DnsManagerService` EE.
 *
 * Note : pas de couplage à `EventLogEmitterService` ici. L'audit log
 * d'activation/désactivation relève du module audit-logs clean-room (tâche
 * dédiée) — on garde ce module autoportant.
 */

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { isDefined } from 'twenty-shared/utils';
import { Repository } from 'typeorm';

import { PublicDomainEntity } from 'src/engine/core-modules/public-domain/public-domain.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { type VeridianCustomDomainResult } from 'src/modules/veridian-custom-domain/dtos/veridian-domain-records.dto';
import {
  VeridianCustomDomainException,
  VeridianCustomDomainExceptionCode,
} from 'src/modules/veridian-custom-domain/veridian-custom-domain.exception';
import { VeridianDnsResolverService } from 'src/modules/veridian-custom-domain/services/veridian-dns-resolver.service';

@Injectable()
export class VeridianCustomDomainService {
  constructor(
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    // Unicité globale d'un custom domain : un domaine ne peut appartenir qu'à un
    // seul workspace, toutes orgs confondues → repository non-scopé volontaire.
    // eslint-disable-next-line twenty/prefer-workspace-scoped-repository
    @InjectRepository(PublicDomainEntity)
    private readonly publicDomainRepository: Repository<PublicDomainEntity>,
    private readonly dnsResolverService: VeridianDnsResolverService,
  ) {}

  /**
   * Déclare (ou met à jour) le custom domain d'un workspace. Idempotent. Ne fait
   * AUCUN appel d'infra : le provisioning est passif (Traefik ACME + CNAME posé
   * par le client). On marque `isCustomDomainEnabled=false` ; il passera à true
   * une fois la vérification DNS/HTTPS validée (via `checkCustomDomain` / cron).
   */
  async setCustomDomain(
    workspace: WorkspaceEntity,
    rawDomain: string,
  ): Promise<VeridianCustomDomainResult> {
    const domain = this.normalize(rawDomain);

    // No-op si déjà ce domaine sur ce workspace.
    if (workspace.customDomain === domain) {
      return this.buildResult(workspace, domain);
    }

    await this.assertDomainIsFree(domain, workspace.id);

    workspace.customDomain = domain;
    workspace.isCustomDomainEnabled = false;

    await this.workspaceRepository.save(workspace);

    return this.buildResult(workspace, domain);
  }

  /**
   * Vérifie l'état DNS/HTTPS du custom domain et synchronise le flag
   * `isCustomDomainEnabled`. Renvoie les records + le statut courant.
   */
  async checkCustomDomain(
    workspace: WorkspaceEntity,
  ): Promise<VeridianCustomDomainResult> {
    if (!isDefined(workspace.customDomain)) {
      throw new VeridianCustomDomainException(
        'No custom domain set for this workspace',
        VeridianCustomDomainExceptionCode.NO_CUSTOM_DOMAIN_SET,
      );
    }

    const isWorking = await this.dnsResolverService.isHostnameWorking(
      workspace.customDomain,
    );

    if (workspace.isCustomDomainEnabled !== isWorking) {
      workspace.isCustomDomainEnabled = isWorking;

      await this.workspaceRepository.save(workspace);
    }

    return this.buildResult(workspace, workspace.customDomain);
  }

  /**
   * Retire le custom domain : le workspace redevient accessible uniquement par
   * son subdomain. Idempotent.
   */
  async removeCustomDomain(workspace: WorkspaceEntity): Promise<boolean> {
    if (!isDefined(workspace.customDomain)) {
      return true;
    }

    workspace.customDomain = null;
    workspace.isCustomDomainEnabled = false;

    await this.workspaceRepository.save(workspace);

    return true;
  }

  /**
   * Garde-fou unicité : refuse un domaine déjà porté par un autre workspace, ou
   * déjà enregistré comme public domain (même règle que le chemin AGPL natif).
   */
  private async assertDomainIsFree(
    domain: string,
    currentWorkspaceId: string,
  ): Promise<void> {
    const existingWorkspace = await this.workspaceRepository.findOne({
      where: { customDomain: domain },
    });

    if (isDefined(existingWorkspace) && existingWorkspace.id !== currentWorkspaceId) {
      throw new VeridianCustomDomainException(
        'Domain already taken by another workspace',
        VeridianCustomDomainExceptionCode.DOMAIN_ALREADY_TAKEN,
      );
    }

    const existingPublicDomain = await this.publicDomainRepository.findOneBy({
      domain,
    });

    if (isDefined(existingPublicDomain)) {
      throw new VeridianCustomDomainException(
        'Domain already registered as a public domain',
        VeridianCustomDomainExceptionCode.DOMAIN_ALREADY_REGISTERED_AS_PUBLIC_DOMAIN,
      );
    }
  }

  private async buildResult(
    workspace: WorkspaceEntity,
    domain: string,
  ): Promise<VeridianCustomDomainResult> {
    const records = await this.dnsResolverService.checkRecords(domain);

    return {
      domain,
      isEnabled: workspace.isCustomDomainEnabled,
      records,
    };
  }

  private normalize(domain: string): string {
    return domain.trim().toLowerCase().replace(/\.$/, '');
  }
}
