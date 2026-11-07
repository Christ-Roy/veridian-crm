import { parseOwnUrl } from 'src/engine/core-modules/veridian-hub-sso/utils/parse-own-url.util';

const SERVER = 'https://crm.staging.veridian.site';

describe('parseOwnUrl (CONTRAT-HUB §6bis.8.0 point 5)', () => {
  it('accepts the app origin', () => {
    expect(parseOwnUrl(`${SERVER}/objects/people?x=1`, SERVER)).toEqual({
      origin: SERVER,
      subdomain: null,
      path: '/objects/people?x=1',
    });
  });

  it('accepts a workspace subdomain', () => {
    expect(
      parseOwnUrl('https://acme.crm.staging.veridian.site/objects', SERVER)
        ?.subdomain,
    ).toBe('acme');
  });

  it.each([
    'https://evil.com/',
    'https://crm.staging.veridian.site.evil.com/',
    'https://evilcrm.staging.veridian.site/',
    'https://a.b.crm.staging.veridian.site/',
    'http://crm.staging.veridian.site/',
    '//evil.com',
    '/objects',
    'javascript:alert(1)',
    '',
    undefined,
    42,
  ])('refuses %s', (candidate) => {
    expect(parseOwnUrl(candidate, SERVER)).toBeNull();
  });
});
