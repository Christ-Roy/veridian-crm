// Identifiant au format UUID v4, déterministe : la même graine donne toujours le même identifiant.
// Sert aux sous-entités des vues (colonnes, filtres, tris, groupes) : une graine ne doit jamais changer, sinon
// `app apply` supprime l'entité pour en créer une neuve.
const fnv = (texte: string, sel: number): number => {
  let h = (0x811c9dc5 ^ sel) >>> 0;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
};

export const uuidStable = (graine: string): string => {
  const hex = [1, 2, 3, 4].map((sel) => fnv(graine, sel * 0x9e3779b1).toString(16).padStart(8, '0')).join('');
  const variante = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variante}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
