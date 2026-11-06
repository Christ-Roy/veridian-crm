export const sanitizeURL = (link: string | null | undefined) => {
  return link
    ? link
        .replace(/(^https?:\/\/)/i, '')
        .replace(/(^www\.)/i, '')
        .replace(/\/$/, '')
    : '';
};

// Veridian : ne plus envoyer les domaines des sociétés à twenty-icons.com.
export const getLogoUrlFromDomainName = (
  _domainName?: string,
): string | undefined => undefined;
