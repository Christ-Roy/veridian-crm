import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { type PluginOption } from 'vite';

// VER-265 (Veridian): the front component sandbox is a srcdoc iframe whose bootstrap is one inline script; it inherits
// the page CSP, so the server needs its sha256. Written next to index.html; a missing document fails the build.
const SANDBOX_DOCUMENT = path.resolve(
  __dirname,
  '../twenty-front-component-renderer/src/remote/sandbox/generated/frontComponentSandboxDocument.ts',
);

export const veridianCspHashesFromSource = (source: string): string[] => {
  const match = source.match(/=\s*("(?:[^"\\]|\\.)*")\s*;?\s*$/);

  if (!match) {
    throw new Error('veridian-csp: sandbox document literal not found');
  }

  const document: string = JSON.parse(match[1]);
  const scripts = [...document.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    (m) => m[1],
  );

  if (scripts.length === 0) {
    throw new Error('veridian-csp: no inline script in the sandbox document');
  }

  return scripts.map(
    (script) =>
      `'sha256-${createHash('sha256').update(script, 'utf8').digest('base64')}'`,
  );
};

export const veridianCspPlugin = (): PluginOption => ({
  name: 'veridian-csp-hashes',
  apply: 'build',
  generateBundle() {
    const scriptHashes = veridianCspHashesFromSource(
      fs.readFileSync(SANDBOX_DOCUMENT, 'utf8'),
    );

    this.emitFile({
      type: 'asset',
      fileName: 'veridian-csp.json',
      source: JSON.stringify({ scriptHashes }),
    });
  },
});
