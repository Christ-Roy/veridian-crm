import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';

import {
  SUSPENDED_WORKSPACE_CLOSED_HANDLERS,
  SUSPENDED_WORKSPACE_OPEN_HANDLERS,
} from 'src/engine/core-modules/veridian-hub-sso/constants/suspended-workspace-handlers.constant';

// Réflexive : chaque @AllowSuspendedWorkspace de l'amont doit être classé (ouvert ou fermé). Un décorateur
// neuf apporté par une synchronisation amont fait échouer cette spec tant qu'il n'est pas classé.

const ENGINE = resolve(__dirname, '../../..');

const listerSources = (dossier: string): string[] =>
  readdirSync(dossier).flatMap((nom) => {
    const chemin = join(dossier, nom);

    if (statSync(chemin).isDirectory()) {
      return listerSources(chemin);
    }

    return nom.endsWith('.ts') &&
      !nom.endsWith('.spec.ts') &&
      !nom.endsWith('.d.ts')
      ? [chemin]
      : [];
  });

// Pour chaque décorateur : la première déclaration de classe ou de méthode qui suit.
// Une déclaration de classe, ou un constructeur, vaut pour toute la classe (clé « Classe.* »).
const clesDuFichier = (texte: string): string[] => {
  const lignes = texte.split('\n');
  const cles: string[] = [];
  let classe = '';

  lignes.forEach((ligne, i) => {
    const decl = ligne.match(/^\s*(?:export\s+)?class\s+(\w+)/);

    if (decl) {
      classe = decl[1];
    }

    if (!/^\s*@AllowSuspendedWorkspace\(\)\s*$/.test(ligne)) {
      return;
    }

    let profondeur = 0;

    for (let j = i + 1; j < lignes.length; j++) {
      const suivante = lignes[j];

      // Les décorateurs, parfois sur plusieurs lignes, ne comptent pas : on saute leurs arguments.
      if (profondeur > 0 || /^\s*@/.test(suivante)) {
        profondeur +=
          (suivante.match(/\(/g) ?? []).length -
          (suivante.match(/\)/g) ?? []).length;
        continue;
      }

      if (/^\s*$/.test(suivante)) {
        continue;
      }

      const cls = suivante.match(/^\s*(?:export\s+)?class\s+(\w+)/);

      if (cls) {
        cles.push(`${cls[1]}.*`);

        return;
      }

      const methode = suivante.match(/^\s*(?:async\s+)?(\w+)\s*\(/);

      if (methode) {
        cles.push(
          methode[1] === 'constructor'
            ? `${classe}.*`
            : `${classe}.${methode[1]}`,
        );

        return;
      }
    }
  });

  return cles;
};

describe('classement des décorateurs @AllowSuspendedWorkspace (Veridian, CONTRAT-HUB §5.4)', () => {
  const trouves = new Set<string>();

  beforeAll(() => {
    for (const fichier of listerSources(ENGINE)) {
      const texte = readFileSync(fichier, 'utf8');

      if (!texte.includes('@AllowSuspendedWorkspace()')) {
        continue;
      }

      for (const cle of clesDuFichier(texte)) {
        trouves.add(cle);
      }
    }
  });

  it('trouve les décorateurs amont (contrôle : la méthode de lecture n est pas aveugle)', () => {
    expect(trouves.size).toBeGreaterThan(20);
    expect(trouves.has('MinimalMetadataResolver.minimalMetadata')).toBe(true);
    expect(trouves.has('WorkspaceResolver.deleteCurrentWorkspace')).toBe(true);
  });

  it('chaque décorateur amont est classé ouvert ou fermé', () => {
    const non_classes = [...trouves].filter(
      (cle) =>
        !SUSPENDED_WORKSPACE_CLOSED_HANDLERS.has(cle) &&
        !SUSPENDED_WORKSPACE_OPEN_HANDLERS.has(cle),
    );

    expect(non_classes).toEqual([]);
  });

  it('aucune entrée classée ne reste sans décorateur amont (liste à jour)', () => {
    const perimees = [
      ...SUSPENDED_WORKSPACE_CLOSED_HANDLERS,
      ...SUSPENDED_WORKSPACE_OPEN_HANDLERS,
    ].filter((cle) => !trouves.has(cle));

    expect(perimees).toEqual([]);
  });
});
