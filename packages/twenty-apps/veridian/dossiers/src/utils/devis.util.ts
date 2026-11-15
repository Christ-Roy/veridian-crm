// Devis d'un dossier : ce qui est promis, distinct de ce qui est réellement encaissé et prouvé.
// Règle de Robert (15/11/2026) : sans argent reçu, c'est encore de la prospection.

export type DevisBrut = {
  id: string;
  numero: string | null;
  dateDevis?: string | null;
  objet?: string | null;
  montant: number | null;
  statut: string | null;
  encaissement: string | null;
  montantEncaisse: number | null;
  preuve?: string | null;
  dossierId: string | null;
};

const HORS_JEU = ['REMPLACE', 'REFUSE'];

// Seul un encaissement PARTIEL ou TOTAL compte ; « Non vérifié » n'est jamais compté, même avec un montant.
export const encaisseProuve = (d: DevisBrut): number =>
  d.encaissement === 'PARTIEL' || d.encaissement === 'TOTAL' ? Math.max(0, d.montantEncaisse ?? 0) : 0;

export const bilanDevis = (devis: DevisBrut[]) => {
  const actifs = devis.filter((d) => !HORS_JEU.includes(d.statut ?? ''));
  return {
    nombre: devis.length,
    promis: actifs.reduce((s, d) => s + (d.montant ?? 0), 0),
    encaisse: devis.reduce((s, d) => s + encaisseProuve(d), 0),
    nonVerifies: actifs.filter((d) => (d.encaissement ?? 'NON_VERIFIE') === 'NON_VERIFIE').length,
  };
};

export type SignalArgent = 'CLIENT_SANS_ENCAISSEMENT' | 'PROSPECTION_ENCAISSEE' | null;

// `encaisseSociete` : l'encaissé prouvé porté par la fiche société (relevé bancaire), qui couvre les factures sans devis.
export const signalArgent = (categorie: string | null, encaisseDevis: number, encaisseSociete: number): SignalArgent => {
  const recu = encaisseDevis > 0 || encaisseSociete > 0;
  if (categorie === 'CLIENT' && !recu) return 'CLIENT_SANS_ENCAISSEMENT';
  if (categorie === 'PROSPECTION' && recu) return 'PROSPECTION_ENCAISSEE';
  return null;
};

export const euros = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : `${n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} €`;
