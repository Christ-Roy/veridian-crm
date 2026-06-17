// Veridian — module AGPL (fork twentyhq/twenty). Mécanique "ouverture de fiche"
// (cf veridian-tunnel-de-vente/docs/VISION-INSTANCE-TWENTY-CUSTOM.md §4).
//
// Logique PURE : construit le payload `updateOneRecordInput` posé quand une
// ouverture de fiche est CONFIRMÉE (le décompte démarré à la FERMETURE s'écoule
// sans re-clic). Aucune dépendance React/Apollo ici → testable isolément.

/**
 * Délai (ms) du décompte de CONFIRMATION, démarré à la FERMETURE d'une fiche.
 *
 * NOUVELLE LOGIQUE (Robert 2026-06-17 — inversion du déclencheur) : le décompte
 * ne démarre PLUS à l'ouverture mais à la FERMETURE de la fiche (side-panel
 * fermé / changement de recordId / navigation hors fiche). Pendant ce décompte
 * la LIGNE de la fiche scintille dans la vue table ; si le commercial RE-CLIQUE
 * sur cette même fiche, le décompte est ANNULÉ et le clic est CONSOMMÉ → la
 * fiche ne se ré-ouvre pas (= fausse manip). Si le décompte s'écoule sans
 * re-clic (même après navigation ailleurs), l'ouverture est CONFIRMÉE
 * (horodatage + statut). Cf VISION §4.1.3.
 */
export const VERIDIAN_RECORD_OPEN_DELAY_MS = 10000;

/**
 * Champs Veridian portant l'événement d'ouverture. Présents sur Company ET
 * Person en prod (folder V1, créés 2026-06-17).
 *
 * - `ficheOuverteAt`   : DATE_TIME (horodatage de l'ouverture confirmée)
 * - `ficheOuverteParId`: colonne de jointure de la RELATION MANY_TO_ONE
 *   `ficheOuvertePar` → workspaceMember. Twenty persiste les relations
 *   many-to-one par leur foreign key (`<relation>Id`), pas par `{ id }`
 *   (cf `usePersistField` → `getForeignKeyNameFromRelationFieldName`).
 *   `sanitizeRecordInput` STRIP la forme objet sans `connect.where` mais
 *   GARDE la forme `...Id` — donc on envoie le FK directement.
 *   (joinColumnName confirmé en prod : `ficheOuverteParId`.)
 */
export const VERIDIAN_FICHE_OUVERTE_AT_FIELD = 'ficheOuverteAt' as const;
export const VERIDIAN_FICHE_OUVERTE_PAR_FK_FIELD = 'ficheOuverteParId' as const;
export const VERIDIAN_STATUT_COLD_CALL_FIELD = 'statutColdCall' as const;

/**
 * Valeurs du SELECT `statutColdCall` impliquées dans la mécanique d'ouverture
 * (présentes en prod sur Company ET Person, cf metadata 2026-06-17).
 *
 * Règle d'or (Robert) : on ne fait PROGRESSER que `A_APPELER → FICHE_OUVERTE`.
 * On ne RÉGRESSE JAMAIS une fiche déjà travaillée (RAPPELER / EN_DISCUSSION /
 * QUALIFIE / PAS_INTERESSE / INJOIGNABLE) : la rouvrir ne doit pas la repasser
 * en "fiche ouverte".
 */
export const VERIDIAN_STATUT_A_APPELER = 'A_APPELER' as const;
export const VERIDIAN_STATUT_FICHE_OUVERTE = 'FICHE_OUVERTE' as const;

export type VeridianRecordOpenInput = {
  [VERIDIAN_FICHE_OUVERTE_AT_FIELD]: string;
  [VERIDIAN_FICHE_OUVERTE_PAR_FK_FIELD]: string;
  [VERIDIAN_STATUT_COLD_CALL_FIELD]?: typeof VERIDIAN_STATUT_FICHE_OUVERTE;
};

type BuildRecordOpenInputOptions = {
  /**
   * Valeur courante du `statutColdCall` de la fiche, lue au moment de la
   * confirmation. Si — et SEULEMENT si — elle vaut `A_APPELER`, on fait
   * progresser le statut vers `FICHE_OUVERTE`. Toute autre valeur (ou
   * undefined/null) → on ne touche PAS au statut.
   */
  currentStatutColdCall?: string | null;
  /**
   * Date d'ouverture (par défaut: maintenant). Sérialisée en ISO (format
   * attendu par un champ DATE_TIME Twenty, cf `isFieldDateTimeValue`).
   */
  openedAt?: Date;
};

/**
 * Construit le payload d'update d'une ouverture confirmée.
 *
 * Pose toujours `ficheOuverteAt` + `ficheOuverteParId`. N'ajoute
 * `statutColdCall = FICHE_OUVERTE` que si le statut courant est `A_APPELER`
 * (progression only, jamais de régression d'une fiche travaillée).
 *
 * @param workspaceMemberId id du commercial qui ouvre la fiche.
 */
export const buildRecordOpenInput = (
  workspaceMemberId: string,
  { currentStatutColdCall, openedAt = new Date() }: BuildRecordOpenInputOptions = {},
): VeridianRecordOpenInput => {
  const input: VeridianRecordOpenInput = {
    [VERIDIAN_FICHE_OUVERTE_AT_FIELD]: openedAt.toISOString(),
    [VERIDIAN_FICHE_OUVERTE_PAR_FK_FIELD]: workspaceMemberId,
  };

  if (currentStatutColdCall === VERIDIAN_STATUT_A_APPELER) {
    input[VERIDIAN_STATUT_COLD_CALL_FIELD] = VERIDIAN_STATUT_FICHE_OUVERTE;
  }

  return input;
};

/**
 * Objets sur lesquels la mécanique d'ouverture s'applique (ceux qui portent
 * les champs `ficheOuverteAt`/`ficheOuvertePar`). Tout autre objet est ignoré
 * → on évite d'envoyer un update qui échouerait (champ inexistant).
 */
export const VERIDIAN_RECORD_OPEN_OBJECTS: ReadonlySet<string> = new Set([
  'company',
  'person',
]);

export const isVeridianRecordOpenObject = (
  objectNameSingular: string,
): boolean => VERIDIAN_RECORD_OPEN_OBJECTS.has(objectNameSingular);
