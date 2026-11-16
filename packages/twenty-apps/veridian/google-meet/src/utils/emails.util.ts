// Adresses des participants : celles des fiches, plus celles tapées à la main. Minuscules, sans doublon, valides.

const FORME_EMAIL = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/;

export const estEmail = (valeur: string): boolean => FORME_EMAIL.test(valeur.trim());

export const normaliserEmails = (valeurs: ReadonlyArray<string | null | undefined>): string[] => {
  const vus = new Set<string>();
  const sortie: string[] = [];
  for (const brut of valeurs) {
    const e = (brut ?? '').trim().toLowerCase();
    if (!e || !estEmail(e) || vus.has(e)) continue;
    vus.add(e);
    sortie.push(e);
  }
  return sortie;
};

// Champ EMAILS de Twenty : { primaryEmail, additionalEmails }.
export type ChampEmails = { primaryEmail?: string | null; additionalEmails?: unknown } | null | undefined;

export const emailsDuChamp = (champ: ChampEmails): string[] => {
  if (!champ) return [];
  const autres = Array.isArray(champ.additionalEmails)
    ? champ.additionalEmails.filter((x): x is string => typeof x === 'string')
    : [];
  return normaliserEmails([champ.primaryEmail, ...autres]);
};

// Texte libre : virgules, points-virgules, espaces ou retours à la ligne. Rend les adresses et les morceaux refusés.
export const decouperSaisie = (texte: string): { emails: string[]; refuses: string[] } => {
  const morceaux = texte.split(/[\s,;]+/).map((m) => m.trim()).filter(Boolean);
  return {
    emails: normaliserEmails(morceaux.filter(estEmail)),
    refuses: morceaux.filter((m) => !estEmail(m)),
  };
};
