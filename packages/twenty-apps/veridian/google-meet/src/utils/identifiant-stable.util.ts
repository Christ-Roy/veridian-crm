// Identifiants dérivés d'une graine : rejouer un import réécrit les mêmes enregistrements au lieu d'en créer.
// SHA-256 par Web Crypto (présent dans le worker du navigateur et dans Node 24), mis au format UUID v4.

const hex = (octets: Uint8Array): string => Array.from(octets, (o) => o.toString(16).padStart(2, '0')).join('');

export const uuidDepuisGraine = async (graine: string): Promise<string> => {
  const empreinte = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(graine)));
  const o = empreinte.slice(0, 16);
  o[6] = (o[6] & 0x0f) | 0x40;
  o[8] = (o[8] & 0x3f) | 0x80;
  const h = hex(o);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

// Identifiant d'événement Google Calendar choisi par nous (base32hex : 0-9 et a-v ; l'hexadécimal en est un
// sous-ensemble). Un second envoi du même formulaire rend 409 au lieu de créer un doublon dans l'agenda.
export const nouvelIdEvenement = (): string => `vrdn${crypto.randomUUID().replace(/-/g, '')}`;

export const estIdEvenementValide = (id: string): boolean => /^[a-v0-9]{5,1024}$/.test(id);
