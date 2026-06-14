/*
 * Veridian CRM — module SSO clean-room (AGPLv3).
 *
 * Implémentation SAML 2.0 (SP-initiated, HTTP-POST binding) à partir du
 * standard OASIS, via la lib publique @node-saml/node-saml. Aucun code EE lu.
 *
 * Deux opérations :
 *  - getLoginUrl  : construit l'URL de redirection vers l'IdP (AuthnRequest)
 *  - validateResponse : vérifie la signature de la réponse IdP et extrait
 *    l'identité normalisée (email + nom).
 */
import { BadRequestException, Injectable } from '@nestjs/common';

import { SAML, type SamlConfig } from '@node-saml/node-saml';

import { type VeridianSamlConfig } from 'src/engine/core-modules/veridian-sso/types/veridian-sso-config.type';
import { type VeridianSsoIdentity } from 'src/engine/core-modules/veridian-sso/types/veridian-sso-identity.type';

const DEFAULT_IDENTIFIER_FORMAT =
  'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress';

@Injectable()
export class VeridianSamlService {
  /**
   * URL de l'IdP vers laquelle rediriger le navigateur pour initier le login.
   * `relayState` transporte l'état (ici l'id du provider) jusqu'à l'ACS.
   */
  async getLoginUrl(
    config: VeridianSamlConfig,
    callbackUrl: string,
    relayState: string,
  ): Promise<string> {
    const saml = this.buildSamlInstance(config, callbackUrl);

    // host vide : pas de cache de métadonnées multi-host côté SP (non pertinent ici).
    return saml.getAuthorizeUrlAsync(relayState, '', {});
  }

  /**
   * Valide une SAMLResponse (POST binding) : signature, audience, conditions,
   * puis extrait l'identité. Lève une 400 si la réponse est invalide ou sans
   * email exploitable.
   */
  async validateResponse(
    config: VeridianSamlConfig,
    callbackUrl: string,
    samlResponse: string,
  ): Promise<VeridianSsoIdentity> {
    const saml = this.buildSamlInstance(config, callbackUrl);

    let profile;

    try {
      const result = await saml.validatePostResponseAsync({
        SAMLResponse: samlResponse,
      });

      profile = result.profile;
    } catch {
      throw new BadRequestException('Invalid SAML response');
    }

    if (!profile) {
      throw new BadRequestException('Invalid SAML response');
    }

    return this.extractIdentity(config, profile as Record<string, unknown>);
  }

  private buildSamlInstance(
    config: VeridianSamlConfig,
    callbackUrl: string,
  ): SAML {
    const options: SamlConfig = {
      callbackUrl,
      entryPoint: config.entryPoint,
      idpCert: config.idpCert,
      issuer: config.issuer,
      identifierFormat: config.identifierFormat ?? DEFAULT_IDENTIFIER_FORMAT,
      // Signatures exigées par défaut (sécurité). Désactivables par IdP si besoin.
      wantAuthnResponseSigned: config.wantAuthnResponseSigned ?? true,
      wantAssertionsSigned: config.wantAssertionsSigned ?? true,
    };

    return new SAML(options);
  }

  private extractIdentity(
    config: VeridianSamlConfig,
    profile: Record<string, unknown>,
  ): VeridianSsoIdentity {
    const email = this.readClaim(profile, [
      config.emailAttribute,
      'email',
      'nameID',
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
    ]);

    if (!email) {
      throw new BadRequestException('SAML response is missing an email');
    }

    const firstName = this.readClaim(profile, [
      config.firstNameAttribute,
      'firstName',
      'givenName',
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
    ]);

    const lastName = this.readClaim(profile, [
      config.lastNameAttribute,
      'lastName',
      'surname',
      'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
    ]);

    return {
      email: email.toLowerCase(),
      firstName,
      lastName,
    };
  }

  private readClaim(
    profile: Record<string, unknown>,
    keys: (string | undefined)[],
  ): string | undefined {
    for (const key of keys) {
      if (!key) {
        continue;
      }

      const value = profile[key];

      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }

    return undefined;
  }
}
