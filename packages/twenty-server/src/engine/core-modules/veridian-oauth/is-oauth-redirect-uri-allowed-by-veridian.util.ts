const LOOPBACK_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]'];

const ASSISTANT_REDIRECT_URIS = [
  // Claude: hosted apps (web, Desktop, mobile, Cowork), claude.com/docs/connectors/building/authentication
  'https://claude.ai/api/mcp/auth_callback',
  // ChatGPT: stable redirect, developers.openai.com/apps-sdk/build/auth
  'https://chatgpt.com/connector_platform_oauth_redirect',
];

// ChatGPT: callback-ID-specific redirect, same page of developers.openai.com
const CHATGPT_CALLBACK_PATH = /^\/connector\/oauth\/[A-Za-z0-9_-]{1,128}$/;

export const isOauthRedirectPolicyOpen = (): boolean =>
  process.env.VERIDIAN_OAUTH_REDIRECT_POLICY === 'open';

export const isOauthRedirectUriAllowedByVeridian = (uri: string): boolean => {
  let parsed: URL;

  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }

  if (parsed.username !== '' || parsed.password !== '' || parsed.hash !== '') {
    return false;
  }

  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    if (LOOPBACK_HOSTNAMES.includes(parsed.hostname)) {
      return true;
    }
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.port !== '' ||
    parsed.search !== ''
  ) {
    return false;
  }

  return (
    ASSISTANT_REDIRECT_URIS.includes(`${parsed.origin}${parsed.pathname}`) ||
    (parsed.origin === 'https://chatgpt.com' &&
      CHATGPT_CALLBACK_PATH.test(parsed.pathname))
  );
};
