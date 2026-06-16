// Veridian — module AGPL (fork twentyhq/twenty). Mécanique "ouverture de fiche"
// (cf veridian-tunnel-de-vente/docs/VISION-INSTANCE-TWENTY-CUSTOM.md §4).
//
// Logique PURE : construit le payload `updateOneRecordInput` posé quand une
// ouverture de fiche est confirmée (≥ VERIDIAN_RECORD_OPEN_DELAY_MS). Aucune
// dépendance React/Apollo ici → testable isolément.

/**
 * Délai (ms) avant qu'une fiche ouverte soit considérée "réellement travaillée".
 * En dessous, le commercial a juste cliqué par erreur / le prospect n'a pas
 * décroché → on n'écrit rien (cf VISION §4.1.3).
 */
export const VERIDIAN_RECORD_OPEN_DELAY_MS = 5000;

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

export type VeridianRecordOpenInput = {
  [VERIDIAN_FICHE_OUVERTE_AT_FIELD]: string;
  [VERIDIAN_FICHE_OUVERTE_PAR_FK_FIELD]: string;
};

/**
 * Construit le payload d'update d'une ouverture confirmée.
 *
 * @param workspaceMemberId id du commercial qui ouvre la fiche.
 * @param openedAt          Date d'ouverture (par défaut: maintenant).
 *                          Sérialisée en ISO (format attendu par un champ
 *                          DATE_TIME Twenty, cf `isFieldDateTimeValue`).
 */
export const buildRecordOpenInput = (
  workspaceMemberId: string,
  openedAt: Date = new Date(),
): VeridianRecordOpenInput => ({
  [VERIDIAN_FICHE_OUVERTE_AT_FIELD]: openedAt.toISOString(),
  [VERIDIAN_FICHE_OUVERTE_PAR_FK_FIELD]: workspaceMemberId,
});

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
