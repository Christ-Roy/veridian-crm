// Markdown simple (titres, puces, gras, liens nus) vers le JSON BlockNote que l'éditeur de notes de Twenty lit.
// Mesuré le 16/11/2026 : une note créée avec `bodyV2.markdown` seul garde `blocknote` à null côté serveur.

type Style = { bold?: true };
type Texte = { type: 'text'; text: string; styles: Style };
type Lien = { type: 'link'; href: string; content: Texte[] };
type Contenu = Texte | Lien;
type Bloc = {
  id: string;
  type: 'paragraph' | 'heading' | 'bulletListItem';
  props: { textColor: 'default'; backgroundColor: 'default'; textAlignment: 'left'; level?: 1 | 2 | 3 };
  content: Contenu[];
  children: never[];
};

const URL_NUE = /(https?:\/\/[^\s)]+)/g;

const enLigne = (texte: string): Contenu[] => {
  const sortie: Contenu[] = [];
  texte.split(/(\*\*[^*]+\*\*)/g).forEach((morceau) => {
    if (!morceau) return;
    const gras = /^\*\*([^*]+)\*\*$/.exec(morceau);
    const brut = gras ? gras[1] : morceau;
    const styles: Style = gras ? { bold: true } : {};
    brut.split(URL_NUE).forEach((partie, i) => {
      if (!partie) return;
      if (i % 2 === 1) sortie.push({ type: 'link', href: partie, content: [{ type: 'text', text: partie, styles }] });
      else sortie.push({ type: 'text', text: partie, styles });
    });
  });
  return sortie;
};

export const markdownVersBlocknote = (markdown: string, prefixeId: string): Bloc[] => {
  const blocs: Bloc[] = [];
  const props = { textColor: 'default', backgroundColor: 'default', textAlignment: 'left' } as const;
  markdown.split('\n').forEach((ligne) => {
    if (!ligne.trim()) return;
    const id = `${prefixeId}-${blocs.length}`;
    const titre = /^(#{1,4})\s+(.*)$/.exec(ligne);
    if (titre) {
      const level = Math.min(3, titre[1].length) as 1 | 2 | 3;
      blocs.push({ id, type: 'heading', props: { ...props, level }, content: enLigne(titre[2]), children: [] });
      return;
    }
    const puce = /^\s*[-*]\s+(.*)$/.exec(ligne);
    if (puce) {
      blocs.push({ id, type: 'bulletListItem', props, content: enLigne(puce[1]), children: [] });
      return;
    }
    blocs.push({ id, type: 'paragraph', props, content: enLigne(ligne), children: [] });
  });
  return blocs;
};
