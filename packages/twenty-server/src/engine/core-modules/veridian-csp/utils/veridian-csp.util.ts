import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// VER-265: the CRM front is a static Vite SPA, so script-src is 'self' plus the sha256 of each inline script, never
// 'unsafe-inline'. The front component sandbox is a srcdoc iframe that inherits this policy: its bootstrap hash is
// written at build time in veridian-csp.json, and its worker and modules load from blob: URLs.
export const VERIDIAN_CSP_REPORT_PATH = '/api/csp';
export const VERIDIAN_CSP_HASHES_FILE = 'veridian-csp.json';

export type VeridianCspMode = 'enforce' | 'report' | 'off';

export const getVeridianCspMode = (): VeridianCspMode => {
  const mode = process.env.VERIDIAN_CSP;

  return mode === 'enforce' || mode === 'report' ? mode : 'off';
};

export const sha256Source = (script: string) =>
  `'sha256-${createHash('sha256').update(script, 'utf8').digest('base64')}'`;

const EXECUTABLE_INLINE_SCRIPT =
  /<script(?![^>]*\bsrc=)(?![^>]*\btype="application\/json")[^>]*>([\s\S]*?)<\/script>/gi;

export const hashInlineScripts = (html: string): string[] =>
  [...html.matchAll(EXECUTABLE_INLINE_SCRIPT)].map((match) =>
    sha256Source(match[1]),
  );

let cachedBuildHashes: { frontPath: string; hashes: string[] | null } | null =
  null;

export const readBuildScriptHashes = (frontPath: string): string[] | null => {
  if (cachedBuildHashes?.frontPath === frontPath) {
    return cachedBuildHashes.hashes;
  }

  const file = join(frontPath, VERIDIAN_CSP_HASHES_FILE);
  let hashes: string[] | null = null;

  if (existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      const values: unknown = parsed?.scriptHashes;

      hashes =
        Array.isArray(values) &&
        values.length > 0 &&
        values.every((v) => typeof v === 'string' && /^'sha256-[A-Za-z0-9+/=]+'$/.test(v))
          ? (values as string[])
          : null;
    } catch {
      hashes = null;
    }
  }

  cachedBuildHashes = { frontPath, hashes };

  return hashes;
};

export const resetVeridianCspCache = () => {
  cachedBuildHashes = null;
};

export const buildVeridianCsp = (scriptHashes: string[]): string =>
  [
    "default-src 'self'",
    `script-src 'self' ${[...new Set(scriptHashes)].join(' ')} blob:`.replace(/\s+/g, ' '),
    "worker-src 'self' blob: data:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "frame-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `report-uri ${VERIDIAN_CSP_REPORT_PATH}`,
  ].join('; ');

type HeaderTarget = {
  getHeader: (name: string) => unknown;
  setHeader: (name: string, value: string | string[]) => unknown;
};

// Enforce without the build hashes falls back to Report-Only, so a broken build never blanks the front component
// sandbox. Enforce keeps Twenty's own policy (frame-ancestors) as a second header: both are applied.
export const applyVeridianCsp = (
  response: HeaderTarget,
  html: string,
  frontPath: string,
  mode: VeridianCspMode = getVeridianCspMode(),
): 'enforce' | 'report' | 'report-sans-empreintes' | null => {
  if (mode === 'off') {
    return null;
  }

  const buildHashes = readBuildScriptHashes(frontPath);
  const policy = buildVeridianCsp([
    ...hashInlineScripts(html),
    ...(buildHashes ?? []),
  ]);
  const applied =
    buildHashes === null
      ? 'report-sans-empreintes'
      : mode === 'enforce'
        ? 'enforce'
        : 'report';

  if (applied === 'enforce') {
    const existing = response.getHeader('Content-Security-Policy');
    const kept = (Array.isArray(existing) ? existing : [existing]).filter(
      (value): value is string => typeof value === 'string' && value.length > 0,
    );

    response.setHeader('Content-Security-Policy', [...kept, policy]);
  } else {
    response.setHeader('Content-Security-Policy-Report-Only', policy);
  }

  response.setHeader('X-Veridian-Csp', applied);

  return applied;
};
