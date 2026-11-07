// CONTRAT-HUB §6bis.8.0 point 5: a URL is followed only on the app's own origin,
// its workspace subdomains included. Anything else goes back to the home page.
export const parseOwnUrl = (
  candidate: unknown,
  serverUrl: string,
): { origin: string; subdomain: string | null; path: string } | null => {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return null;
  }

  try {
    const url = new URL(candidate);
    const server = new URL(serverUrl);

    if (url.protocol !== server.protocol) {
      return null;
    }

    const isSameHost = url.host === server.host;
    const isSubdomain = url.host.endsWith(`.${server.host}`);

    if (!isSameHost && !isSubdomain) {
      return null;
    }

    const subdomain = isSubdomain
      ? url.host.slice(0, -`.${server.host}`.length)
      : null;

    if (subdomain !== null && subdomain.includes('.')) {
      return null;
    }

    return {
      origin: url.origin,
      subdomain,
      path: `${url.pathname}${url.search}`,
    };
  } catch {
    return null;
  }
};
