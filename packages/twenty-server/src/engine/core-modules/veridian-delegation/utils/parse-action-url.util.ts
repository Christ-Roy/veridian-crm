// An action token only leaves for a Veridian host, whatever the Hub answers.
export const parseActionUrl = (url: unknown): string | null => {
  if (typeof url !== 'string' || !URL.canParse(url)) {
    return null;
  }

  const { protocol, port, hostname, username, password, search, hash, href } =
    new URL(url);

  return protocol === 'https:' &&
    port === '' &&
    username === '' &&
    password === '' &&
    search === '' &&
    hash === '' &&
    hostname.endsWith('.veridian.site')
    ? href.replace(/\/+$/, '')
    : null;
};
