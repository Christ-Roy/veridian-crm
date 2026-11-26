import { RequestMethod } from '@nestjs/common';

import { VeridianOauthModule } from 'src/engine/core-modules/veridian-oauth/veridian-oauth.module';
import { VeridianOauthRedirectPolicyMiddleware } from 'src/engine/core-modules/veridian-oauth/veridian-oauth-redirect-policy.middleware';
import { isOauthRedirectUriAllowedByVeridian } from 'src/engine/core-modules/veridian-oauth/is-oauth-redirect-uri-allowed-by-veridian.util';

// Patch-survival Veridian (R1, GHSA-pg47-7c3r-fwfx): the public dynamic registration only accepts
// loopback or known-assistant redirect URIs.
describe('politique des redirect_uri de POST /oauth/register', () => {
  const env = { ...process.env };

  afterEach(() => {
    process.env = { ...env };
  });

  const run = (redirectUris: unknown) => {
    const res = {
      statusCode: 0,
      body: undefined as unknown,
      status(code: number) {
        res.statusCode = code;

        return res;
      },
      json(body: unknown) {
        res.body = body;

        return res;
      },
    };
    const next = jest.fn();

    new VeridianOauthRedirectPolicyMiddleware().use(
      { body: { redirect_uris: redirectUris } } as never,
      res as never,
      next,
    );

    return { res, next };
  };

  it.each([
    'http://127.0.0.1:37735/retour',
    'http://localhost:3118/callback',
    'http://[::1]:8080/cb',
    'https://localhost/cb',
    'http://127.0.0.1/',
  ])('accepts the loopback address %s', (uri) => {
    expect(isOauthRedirectUriAllowedByVeridian(uri)).toBe(true);
    const { next, res } = run([uri]);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(0);
  });

  it.each([
    'https://claude.ai/api/mcp/auth_callback',
    'https://chatgpt.com/connector_platform_oauth_redirect',
    'https://chatgpt.com/connector/oauth/abc123_X-9',
  ])('accepts the listed assistant address %s', (uri) => {
    expect(isOauthRedirectUriAllowedByVeridian(uri)).toBe(true);
    expect(run([uri]).next).toHaveBeenCalledTimes(1);
  });

  it.each([
    'https://app.exemple.com/callback',
    'https://claude.ai/autre/chemin',
    'https://claude.ai/api/mcp/auth_callback/',
    'https://claude.ai/api/mcp/auth_callback?x=1',
    'https://chatgpt.com/connector/oauth/',
    'https://chatgpt.com/connector/oauth/a/b',
    'https://claude.com/api/mcp/auth_callback',
  ])('refuses the invented or inexact address %s', (uri) => {
    expect(isOauthRedirectUriAllowedByVeridian(uri)).toBe(false);
  });

  it.each([
    'https://claude.ai.exemple.com/api/mcp/auth_callback',
    'https://chatgpt.com.exemple.com/connector_platform_oauth_redirect',
    'https://exemple.com/https://claude.ai/api/mcp/auth_callback',
    'https://claude.ai@exemple.com/api/mcp/auth_callback',
    'https://claude.ai:8443/api/mcp/auth_callback',
    'https://claude.ai./api/mcp/auth_callback',
    'http://localhost.exemple.com/cb',
    'http://localhost@exemple.com/cb',
    'http://127.0.0.1.exemple.com/cb',
    'https://exemple.com/connector/oauth/abc123',
    'https://user:pw@claude.ai/api/mcp/auth_callback',
    'http://user@localhost/cb',
    'cursor://localhost/cb',
  ])('refuses the trapped address %s', (uri) => {
    expect(isOauthRedirectUriAllowedByVeridian(uri)).toBe(false);
  });

  it.each([
    'http://claude.ai/api/mcp/auth_callback',
    'http://exemple.com/cb',
    'cursor://anysphere.cursor-retrieve/mcp/oauth/callback',
    'javascript:alert(1)',
    'pas une adresse',
    'http://localhost/cb#frag',
  ])('refuses the non-local http, custom scheme or malformed %s', (uri) => {
    expect(isOauthRedirectUriAllowedByVeridian(uri)).toBe(false);
  });

  it('answers 400 invalid_redirect_uri and never reaches the controller', () => {
    const { res, next } = run(['https://app.exemple.com/callback']);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      error: 'invalid_redirect_uri',
      error_description: expect.stringContaining('redirect_uris'),
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('refuses the whole request when one address among several is refused', () => {
    const { res, next } = run([
      'http://127.0.0.1:1234/cb',
      'https://app.exemple.com/callback',
    ]);

    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('refuses a non-string entry', () => {
    const { res, next } = run([null]);

    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  it.each([[undefined], ['https://app.exemple.com'], [[]]])(
    'refuses a registration without a list of return addresses (%p)',
    (uris) => {
      const { res, next } = run(uris);

      expect(res.statusCode).toBe(400);
      expect(next).not.toHaveBeenCalled();
    },
  );

  it('restores the upstream behavior when the switch is open', () => {
    process.env.VERIDIAN_OAUTH_REDIRECT_POLICY = 'open';
    const { res, next } = run(['https://app.exemple.com/callback']);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(0);
  });

  it('applies the policy for any other value of the switch', () => {
    process.env.VERIDIAN_OAUTH_REDIRECT_POLICY = 'OPEN';
    expect(run(['https://app.exemple.com/callback']).res.statusCode).toBe(400);
    process.env.VERIDIAN_OAUTH_REDIRECT_POLICY = '';
    expect(run(['https://app.exemple.com/callback']).res.statusCode).toBe(400);
  });

  it('is mounted on POST /oauth/register only', () => {
    const forRoutes = jest.fn();
    const apply = jest.fn().mockReturnValue({ forRoutes });

    new VeridianOauthModule().configure({ apply } as never);

    expect(apply).toHaveBeenCalledWith(VeridianOauthRedirectPolicyMiddleware);
    expect(forRoutes).toHaveBeenCalledWith({
      path: 'oauth/register',
      method: RequestMethod.POST,
    });
  });
});
