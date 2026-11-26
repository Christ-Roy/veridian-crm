// VER-265: a violation is logged without query string, fragment or code sample, and without the host (the
// subdomain names a client workspace).
export type CspViolation = {
  page: string;
  directive: string;
  blocked: string;
  source: string;
  line: number | null;
  disposition: string;
};

const text = (value: unknown, max = 200): string =>
  typeof value === 'string' ? value.slice(0, max) : '';

const withoutSecrets = (value: unknown): string => {
  const raw = text(value, 500);

  if (raw === '' || /^[a-z-]+$/i.test(raw)) {
    return raw;
  }

  try {
    const url = new URL(raw);

    if (url.protocol === 'blob:' || url.protocol === 'data:') {
      return url.protocol.slice(0, -1);
    }

    if (url.protocol === 'about:') {
      return raw.split(/[?#]/)[0].slice(0, 40);
    }

    return url.pathname.slice(0, 200);
  } catch {
    return raw.split(/[?#]/)[0].slice(0, 200);
  }
};

const ofOrigin = (value: unknown): string => {
  const raw = text(value, 500);

  try {
    const url = new URL(raw);

    if (url.protocol === 'blob:' || url.protocol === 'data:') {
      return url.protocol.slice(0, -1);
    }

    return url.origin === 'null' ? raw.split(/[?#]/)[0].slice(0, 40) : url.origin;
  } catch {
    return raw.split(/[?#:]/)[0].slice(0, 60);
  }
};

// Accepts the report-uri body ({"csp-report": {...}}) and the Reporting API body ([{type, body: {...}}]).
export const sanitizeCspReports = (payload: unknown): CspViolation[] => {
  const entries: Record<string, unknown>[] = [];

  if (Array.isArray(payload)) {
    for (const item of payload.slice(0, 20)) {
      if (item?.type === 'csp-violation' && typeof item.body === 'object') {
        entries.push(item.body);
      }
    }
  } else if (
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as Record<string, unknown>)['csp-report'] === 'object'
  ) {
    entries.push((payload as Record<string, Record<string, unknown>>)['csp-report']);
  }

  return entries.map((report) => {
    const line = report['line-number'] ?? report.lineNumber;

    return {
      page: withoutSecrets(report['document-uri'] ?? report.documentURL),
      directive: text(
        report['effective-directive'] ??
          report.effectiveDirective ??
          report['violated-directive'],
        60,
      ),
      blocked: ofOrigin(report['blocked-uri'] ?? report.blockedURL),
      source: withoutSecrets(report['source-file'] ?? report.sourceFile),
      line: typeof line === 'number' && Number.isFinite(line) ? line : null,
      disposition: text(report.disposition, 20),
    };
  });
};
