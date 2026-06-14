/*
 * Veridian CRM — module SSO clean-room (AGPLv3).
 *
 * SSO SAML 2.0 / OIDC réimplémenté depuis les protocoles standards, branché
 * uniquement sur des points d'accroche AGPL de Twenty (AuthModule expose
 * SignInUpService / LoginTokenService / AuthService). Aucun code EE.
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from 'src/engine/core-modules/auth/auth.module';
import { SecretEncryptionModule } from 'src/engine/core-modules/secret-encryption/secret-encryption.module';
import { UserModule } from 'src/engine/core-modules/user/user.module';
import { VeridianSsoController } from 'src/engine/core-modules/veridian-sso/controllers/veridian-sso.controller';
import { VeridianSsoProviderEntity } from 'src/engine/core-modules/veridian-sso/entities/veridian-sso-provider.entity';
import { VeridianOidcService } from 'src/engine/core-modules/veridian-sso/services/veridian-oidc.service';
import { VeridianSamlService } from 'src/engine/core-modules/veridian-sso/services/veridian-saml.service';
import { VeridianSsoAuthService } from 'src/engine/core-modules/veridian-sso/services/veridian-sso-auth.service';
import { VeridianSsoProviderService } from 'src/engine/core-modules/veridian-sso/services/veridian-sso-provider.service';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([VeridianSsoProviderEntity, WorkspaceEntity]),
    AuthModule,
    UserModule,
    SecretEncryptionModule,
  ],
  controllers: [VeridianSsoController],
  providers: [
    VeridianSsoProviderService,
    VeridianSamlService,
    VeridianOidcService,
    VeridianSsoAuthService,
  ],
  exports: [VeridianSsoProviderService],
})
export class VeridianSsoModule {}
