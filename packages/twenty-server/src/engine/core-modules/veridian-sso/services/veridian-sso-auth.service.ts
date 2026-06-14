/*
 * Veridian CRM — module SSO clean-room (AGPLv3).
 *
 * Orchestration du login SSO une fois l'identité IdP validée :
 *   identité validée → JIT provisioning → loginToken Twenty natif → URL de redirect.
 *
 * Se branche EXCLUSIVEMENT sur des points d'accroche AGPL de Twenty (cf
 * docs/spec/09-module-sso-saml-oidc.md §4) :
 *   - SignInUpService.signInUp     (JIT : crée/attache le user au workspace)
 *   - LoginTokenService.generateLoginToken
 *   - AuthService.computeRedirectURI
 * Reproduit le pattern de l'OAuth Google/Microsoft AGPL (signInUpWithSocialSSO),
 * sans toucher au controller SSO EE.
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { AuthService } from 'src/engine/core-modules/auth/services/auth.service';
import { SignInUpService } from 'src/engine/core-modules/auth/services/sign-in-up.service';
import { LoginTokenService } from 'src/engine/core-modules/auth/token/services/login-token.service';
import { type SignInUpNewUserPayload } from 'src/engine/core-modules/auth/types/signInUp.type';
import { UserService } from 'src/engine/core-modules/user/services/user.service';
import { type VeridianSsoIdentity } from 'src/engine/core-modules/veridian-sso/types/veridian-sso-identity.type';
import { AuthProviderEnum } from 'src/engine/core-modules/workspace/types/workspace.type';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';

@Injectable()
export class VeridianSsoAuthService {
  constructor(
    @InjectRepository(WorkspaceEntity)
    private readonly workspaceRepository: Repository<WorkspaceEntity>,
    private readonly userService: UserService,
    private readonly signInUpService: SignInUpService,
    private readonly loginTokenService: LoginTokenService,
    private readonly authService: AuthService,
  ) {}

  /**
   * Provisionne (JIT) le user identifié par l'IdP sur le workspace du provider,
   * génère un loginToken Twenty natif et renvoie l'URL de redirection front
   * (`/verify?loginToken=…`) que le navigateur suivra. Le front consomme
   * ensuite ce loginToken via le flow AGPL `getAuthTokensFromLoginToken`.
   */
  async completeSignIn(
    identity: VeridianSsoIdentity,
    workspaceId: string,
  ): Promise<string> {
    const workspace = await this.workspaceRepository.findOne({
      where: { id: workspaceId },
      relations: ['approvedAccessDomains'],
    });

    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }

    const existingUser = await this.userService.findUserByEmail(
      identity.email,
    );

    const newUserPayload: SignInUpNewUserPayload = {
      email: identity.email,
      firstName: identity.firstName ?? '',
      lastName: identity.lastName ?? '',
      isEmailAlreadyVerified: true,
    };

    // Conversion via le helper AGPL : SignInUpNewUserPayload → PartialUserWithPicture
    // (mappe isEmailAlreadyVerified → isEmailVerified, applique les defaults).
    const userData = existingUser
      ? ({ type: 'existingUser', existingUser } as const)
      : ({
          type: 'newUserWithPicture',
          newUserWithPicture:
            await this.signInUpService.computePartialUserFromUserPayload(
              newUserPayload,
              { provider: AuthProviderEnum.SSO },
            ),
        } as const);

    // JIT : SignInUpService.signInUp crée le user si absent et l'attache au
    // workspace (ou ré-attache l'existant). Point d'accroche AGPL.
    const { user, workspace: signedInWorkspace } =
      await this.signInUpService.signInUp({
        workspace,
        userData,
        authParams: { provider: AuthProviderEnum.SSO },
      });

    const targetWorkspace = signedInWorkspace ?? workspace;

    const loginToken = await this.loginTokenService.generateLoginToken(
      user.email,
      targetWorkspace.id,
      AuthProviderEnum.SSO,
    );

    return this.authService.computeRedirectURI({
      loginToken: loginToken.token,
      workspace: targetWorkspace,
    });
  }
}
