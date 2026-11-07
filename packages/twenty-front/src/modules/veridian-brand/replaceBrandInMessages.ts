// `.github/TRADEMARK.md` requires a fork run publicly to carry its own name. Rewriting the compiled
// catalog at load time covers every locale and leaves the upstream sources and `.po` files intact.
const UPSTREAM_BRAND = /\bTwenty\b/g;
const VERIDIAN_BRAND = 'Veridian CRM';

const replaceBrand = (message: unknown): unknown => {
  if (typeof message === 'string') {
    return message.replace(UPSTREAM_BRAND, VERIDIAN_BRAND);
  }

  if (Array.isArray(message)) {
    return message.map(replaceBrand);
  }

  if (typeof message === 'object' && message !== null) {
    return Object.fromEntries(
      Object.entries(message).map(([key, value]) => [key, replaceBrand(value)]),
    );
  }

  return message;
};

export const replaceBrandInMessages = <T extends Record<string, unknown>>(
  messages: T,
): T => replaceBrand(messages) as T;
