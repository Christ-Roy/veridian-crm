/*
 * Veridian CRM — Custom domain (white-label) clean-room module.
 * Copyright (c) 2026-present Veridian. Licensed under AGPLv3.
 *
 * Module 100 % AGPL, autoportant : ne dépend que de l'entité workspace + de
 * l'entité public-domain (pour l'unicité). AUCUNE dépendance au code EE
 * (DnsManagerModule / CloudflareModule) — la vérif DNS/HTTPS est notre
 * `VeridianDnsResolverService` clean-room.
 */

import { Module } from '@nestjs/common';

import { NestjsQueryTypeOrmModule } from '@ptc-org/nestjs-query-typeorm';

import { PublicDomainEntity } from 'src/engine/core-modules/public-domain/public-domain.entity';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { PermissionsModule } from 'src/engine/metadata-modules/permissions/permissions.module';
import { CheckVeridianCustomDomainsCronCommand } from 'src/modules/veridian-custom-domain/crons/commands/check-veridian-custom-domains.cron.command';
import { CheckVeridianCustomDomainsCronJob } from 'src/modules/veridian-custom-domain/crons/jobs/check-veridian-custom-domains.cron.job';
import { VeridianCustomDomainResolver } from 'src/modules/veridian-custom-domain/resolvers/veridian-custom-domain.resolver';
import { VeridianCustomDomainService } from 'src/modules/veridian-custom-domain/services/veridian-custom-domain.service';
import { VeridianDnsResolverService } from 'src/modules/veridian-custom-domain/services/veridian-dns-resolver.service';

@Module({
  imports: [
    NestjsQueryTypeOrmModule.forFeature([WorkspaceEntity, PublicDomainEntity]),
    PermissionsModule,
  ],
  providers: [
    VeridianDnsResolverService,
    VeridianCustomDomainService,
    VeridianCustomDomainResolver,
    CheckVeridianCustomDomainsCronCommand,
    CheckVeridianCustomDomainsCronJob,
  ],
  exports: [
    VeridianCustomDomainService,
    VeridianDnsResolverService,
    CheckVeridianCustomDomainsCronCommand,
  ],
})
export class VeridianCustomDomainModule {}
