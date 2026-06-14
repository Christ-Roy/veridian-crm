/*
 * Veridian CRM — Custom domain (white-label) clean-room module.
 * Copyright (c) 2026-present Veridian. Licensed under AGPLv3.
 *
 * API GraphQL admin pour déclarer / vérifier / retirer un custom domain.
 * Gardée comme le resolver AGPL public-domain : auth workspace + permission
 * settings (WORKSPACE_MEMBERS) — seul un admin du workspace peut configurer le
 * white-label.
 */

import { UseGuards } from '@nestjs/common';
import { Args, Mutation, Query } from '@nestjs/graphql';

import { PermissionFlagType } from 'twenty-shared/constants';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { SettingsPermissionGuard } from 'src/engine/guards/settings-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { SetVeridianCustomDomainInput } from 'src/modules/veridian-custom-domain/dtos/set-custom-domain.input';
import { VeridianCustomDomainResult } from 'src/modules/veridian-custom-domain/dtos/veridian-domain-records.dto';
import { VeridianCustomDomainService } from 'src/modules/veridian-custom-domain/services/veridian-custom-domain.service';

@UseGuards(
  WorkspaceAuthGuard,
  SettingsPermissionGuard(PermissionFlagType.WORKSPACE_MEMBERS),
)
@MetadataResolver()
export class VeridianCustomDomainResolver {
  constructor(
    private readonly veridianCustomDomainService: VeridianCustomDomainService,
  ) {}

  @Query(() => VeridianCustomDomainResult)
  async veridianCustomDomain(
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<VeridianCustomDomainResult> {
    // Lecture seule : si aucun domaine, on renvoie un résultat vide plutôt que
    // de throw — l'UI affiche "aucun custom domain".
    if (!workspace.customDomain) {
      return { domain: null, isEnabled: false, records: [] };
    }

    return this.veridianCustomDomainService.checkCustomDomain(workspace);
  }

  @Mutation(() => VeridianCustomDomainResult)
  async setVeridianCustomDomain(
    @Args() { domain }: SetVeridianCustomDomainInput,
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<VeridianCustomDomainResult> {
    return this.veridianCustomDomainService.setCustomDomain(workspace, domain);
  }

  @Mutation(() => VeridianCustomDomainResult)
  async checkVeridianCustomDomain(
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<VeridianCustomDomainResult> {
    return this.veridianCustomDomainService.checkCustomDomain(workspace);
  }

  @Mutation(() => Boolean)
  async removeVeridianCustomDomain(
    @AuthWorkspace() workspace: WorkspaceEntity,
  ): Promise<boolean> {
    return this.veridianCustomDomainService.removeCustomDomain(workspace);
  }
}
