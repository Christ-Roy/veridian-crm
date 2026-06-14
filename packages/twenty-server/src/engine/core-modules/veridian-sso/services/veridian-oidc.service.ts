/*
 * Veridian CRM — module SSO clean-room (AGPLv3).
 *
 * Implémentation OIDC (Authorization Code flow) à partir du standard OpenID
 * Connect, via la lib publique openid-client v5. Aucun code EE lu.
 *
 *  - getAuthorizationUrl : discovery de l'issuer + URL d'autorisation (state, nonce)
 *  - handleCallback      : échange du code, validation id_token (nonce), userinfo
 *    → identité normalisée.
 *
 * Stateless : state + nonce sont gérés par le controller (cookie httpOnly signé),
 * pas de session serveur — cohérent avec le modèle de Twenty.
 */
import { BadRequestException, Injectable } from '@nestjs/common';

import { Issuer, type Client } from 'openid-client';

import { type VeridianOidcConfig } from 'src/engine/core-modules/veridian-sso/types/veridian-sso-config.type';
import { type VeridianSsoIdentity } from 'src/engine/core-modules/veridian-sso/types/veridian-sso-identity.type';

const DEFAULT_SCOPE = 'openid email profile';

@Injectable()
export class VeridianOidcService {
  async getAuthorizationUrl(
    config: VeridianOidcConfig,
    redirectUri: string,
    state: string,
    nonce: string,
  ): Promise<string> {
    const client = await this.buildClient(config, redirectUri);

    return client.authorizationUrl({
      scope: config.scope ?? DEFAULT_SCOPE,
      state,
      nonce,
    });
  }

  /**
   * Traite le retour de l'IdP : échange le code contre les tokens, valide
   * l'id_token (state + nonce), récupère le profil et le normalise.
   */
  async handleCallback(
    config: VeridianOidcConfig,
    redirectUri: string,
    callbackParams: Record<string, string>,
    expected: { state: string; nonce: string },
  ): Promise<VeridianSsoIdentity> {
    const client = await this.buildClient(config, redirectUri);

    let claims: Record<string, unknown>;

    try {
      const tokenSet = await client.callback(redirectUri, callbackParams, {
        state: expected.state,
        nonce: expected.nonce,
      });

      claims = tokenSet.claims() as Record<string, unknown>;

      // L'email peut n'être servi que par le userinfo endpoint selon l'IdP.
      if (!this.readClaim(claims, [config.emailClaim, 'email'])) {
        const accessToken = tokenSet.access_token;

        if (accessToken) {
          const userInfo = (await client.userinfo(accessToken)) as Record<
            string,
            unknown
          >;

          claims = { ...claims, ...userInfo };
        }
      }
    } catch {
      throw new BadRequestException('Invalid OIDC callback');
    }

    return this.extractIdentity(config, claims);
  }

  private async buildClient(
    config: VeridianOidcConfig,
    redirectUri: string,
  ): Promise<Client> {
    const issuer = await Issuer.discover(config.issuerUrl);

    return new issuer.Client({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uris: [redirectUri],
      response_types: ['code'],
    });
  }

  private extractIdentity(
    config: VeridianOidcConfig,
    claims: Record<string, unknown>,
  ): VeridianSsoIdentity {
    const email = this.readClaim(claims, [config.emailClaim, 'email']);

    if (!email) {
      throw new BadRequestException('OIDC response is missing an email');
    }

    const firstName = this.readClaim(claims, [
      config.firstNameClaim,
      'given_name',
    ]);

    const lastName = this.readClaim(claims, [
      config.lastNameClaim,
      'family_name',
    ]);

    return {
      email: email.toLowerCase(),
      firstName,
      lastName,
    };
  }

  private readClaim(
    claims: Record<string, unknown>,
    keys: (string | undefined)[],
  ): string | undefined {
    for (const key of keys) {
      if (!key) {
        continue;
      }

      const value = claims[key];

      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }

    return undefined;
  }
}
