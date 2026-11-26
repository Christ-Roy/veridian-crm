import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { renderFrontendHtml } from 'src/engine/core-modules/frontend/utils/render-frontend-html.util';
import { SIGN_IN_PAGE_CONTENT_SECURITY_POLICY } from 'src/engine/core-modules/veridian-hub-sso/utils/build-sign-in-page.util';
import { sanitizeCspReports } from 'src/engine/core-modules/veridian-csp/utils/sanitize-csp-report.util';
import {
  applyVeridianCsp,
  buildVeridianCsp,
  hashInlineScripts,
  resetVeridianCspCache,
  sha256Source,
} from 'src/engine/core-modules/veridian-csp/utils/veridian-csp.util';

// Veridian VER-265 (26/11/2026) : CSP du front sans 'unsafe-inline' dans script-src, empreintes des scripts inline
// (page et bac à sable des composants front), Report-Only tant que VERIDIAN_CSP ne dit pas enforce.
const TEMPLATE =
  '<html><head><!-- BEGIN: Twenty Config --><!-- END: Twenty Config --></head><body><script type="module" src="/assets/index.js"></script></body></html>';
const SANDBOX = "'sha256-c2FuZGJveA=='";

const fauxFront = (contenu?: string) => {
  const dossier = mkdtempSync(join(tmpdir(), 'csp-'));

  if (contenu !== undefined) {
    writeFileSync(join(dossier, 'veridian-csp.json'), contenu);
  }

  return dossier;
};

const fausseReponse = (existant?: string) => {
  const entetes: Record<string, string | string[]> = existant
    ? { 'Content-Security-Policy': existant }
    : {};

  return {
    entetes,
    getHeader: (nom: string) => entetes[nom],
    setHeader: (nom: string, valeur: string | string[]) => {
      entetes[nom] = valeur;
    },
  };
};

const html = renderFrontendHtml({
  template: TEMPLATE,
  clientConfig: { a: 1 },
  iframeMediaPermissions: [],
});

describe('Veridian CSP (VER-265)', () => {
  beforeEach(() => resetVeridianCspCache());

  it('empreinte le seul script inline exécutable de la page, jamais les JSON ni les scripts externes', () => {
    expect(hashInlineScripts(html)).toEqual([sha256Source('window._env_ = {};')]);
  });

  it("script-src n'admet ni 'unsafe-inline' ni 'unsafe-eval'", () => {
    const politique = buildVeridianCsp([SANDBOX]);
    const scriptSrc = politique.split('; ').find((d) => d.startsWith('script-src ')) ?? '';

    expect(scriptSrc).toBe(`script-src 'self' ${SANDBOX} blob:`);
    expect(politique).not.toMatch(/unsafe-eval/);
    expect(politique).toContain("object-src 'none'");
    expect(politique).toContain('report-uri /api/csp');
    expect(politique).not.toContain('report-to');
  });

  it('Report-Only par défaut, avec les empreintes du build et de la page', () => {
    const r = fausseReponse("frame-ancestors 'self'");

    expect(applyVeridianCsp(r, html, fauxFront(JSON.stringify({ scriptHashes: [SANDBOX] })), 'report')).toBe('report');
    expect(r.entetes['Content-Security-Policy']).toBe("frame-ancestors 'self'");
    expect(r.entetes['Content-Security-Policy-Report-Only']).toContain(SANDBOX);
    expect(r.entetes['Content-Security-Policy-Report-Only']).toContain(sha256Source('window._env_ = {};'));
  });

  it('enforce garde la politique amont et ajoute la nôtre', () => {
    const r = fausseReponse("frame-ancestors 'self'");

    expect(applyVeridianCsp(r, html, fauxFront(JSON.stringify({ scriptHashes: [SANDBOX] })), 'enforce')).toBe('enforce');
    const valeurs = r.entetes['Content-Security-Policy'] as string[];

    expect(valeurs[0]).toBe("frame-ancestors 'self'");
    expect(valeurs[1]).toContain(`script-src 'self'`);
    expect(r.entetes['Content-Security-Policy-Report-Only']).toBeUndefined();
  });

  it('enforce sans empreintes du build retombe en Report-Only (le bac à sable ne casse jamais)', () => {
    for (const contenu of [undefined, '{}', '{"scriptHashes":["inline"]}', 'pas du json']) {
      resetVeridianCspCache();
      const r = fausseReponse("frame-ancestors 'self'");

      expect(applyVeridianCsp(r, html, fauxFront(contenu), 'enforce')).toBe('report-sans-empreintes');
      expect(r.entetes['Content-Security-Policy']).toBe("frame-ancestors 'self'");
    }
  });

  it('off ne pose rien (témoin)', () => {
    const r = fausseReponse();

    expect(applyVeridianCsp(r, html, fauxFront('{}'), 'off')).toBeNull();
    expect(r.entetes).toEqual({});
  });

  it('un rapport est journalisé sans query, sans hôte et sans extrait de code', () => {
    const [v] = sanitizeCspReports({
      'csp-report': {
        'document-uri': 'https://client.crm.app.veridian.site/objects/people?filter=secret#x',
        'effective-directive': 'script-src-elem',
        'blocked-uri': 'https://evil.example/x.js?token=abc',
        'source-file': 'https://client.crm.app.veridian.site/assets/index.js?v=1',
        'line-number': 12,
        'script-sample': 'alert(document.cookie)',
        disposition: 'report',
      },
    });

    expect(v).toEqual({
      page: '/objects/people',
      directive: 'script-src-elem',
      blocked: 'https://evil.example',
      source: '/assets/index.js',
      line: 12,
      disposition: 'report',
    });
    expect(JSON.stringify(v)).not.toMatch(/secret|token|cookie|client\./);
  });

  it('lit aussi le format Reporting API et ignore le reste', () => {
    const v = sanitizeCspReports([
      { type: 'csp-violation', body: { documentURL: 'about:srcdoc', effectiveDirective: 'script-src-elem', blockedURL: 'inline' } },
      { type: 'deprecation', body: {} },
    ]);

    expect(v).toEqual([
      { page: 'about:srcdoc', directive: 'script-src-elem', blocked: 'inline', source: '', line: null, disposition: '' },
    ]);
    expect(sanitizeCspReports('rien')).toEqual([]);
  });

  it('la page de connexion du Hub interdit tout script et tout encadrement', () => {
    expect(SIGN_IN_PAGE_CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
    expect(SIGN_IN_PAGE_CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(SIGN_IN_PAGE_CONTENT_SECURITY_POLICY).not.toMatch(/script-src/);
  });
});
