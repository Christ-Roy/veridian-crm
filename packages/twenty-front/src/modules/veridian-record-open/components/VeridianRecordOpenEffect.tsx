// Veridian — module AGPL (fork twentyhq/twenty). Mécanique "ouverture de fiche"
// (cf veridian-tunnel-de-vente/docs/VISION-INSTANCE-TWENTY-CUSTOM.md §4).
//
// NOUVELLE LOGIQUE INVERSÉE (Robert 2026-06-17) : le déclencheur n'est plus
// l'OUVERTURE mais la FERMETURE de la fiche.
//
//   1. On OUVRE une fiche (pleine page OU side-panel) → RIEN ne se passe : pas
//      de timer, pas d'écriture. (Ce composant se monte, c'est tout.)
//   2. On QUITTE/FERME la fiche (side-panel fermé / changement de recordId /
//      navigation hors fiche → ce composant se DÉMONTE ou son recordId change)
//      → c'est À CE MOMENT que démarre un décompte de 10 s (planifié dans le
//      `recordOpenManager`, MODULE-LEVEL, donc il SURVIT au démontage).
//   3. Pendant les 10 s : la LIGNE de la fiche scintille dans la vue table
//      (atom global `veridianPendingOpenKeysState` → `RecordTableTr`).
//   4. Re-clic sur la fiche pendant les 10 s → `cancelRecordOpen` (déclenché par
//      le patch de `useOpenRecordFromIndexView`) : décompte annulé, clic
//      consommé, fiche NON ré-ouverte, reste A_APPELER.
//   5. 10 s écoulées sans re-clic → écriture confirmée (`ficheOuverteAt` +
//      `ficheOuverteParId` + progression `statutColdCall` A_APPELER→
//      FICHE_OUVERTE only, jamais de régression).
//
// CE COMPOSANT NE REND RIEN (plus d'overlay : l'animation est sur la ROW). Son
// SEUL rôle : OBSERVER l'ouverture/fermeture pour PLANIFIER le décompte à la
// fermeture, en capturant dans le callback (qui vit dans le manager, hors React)
// tout ce dont l'écriture aura besoin : objectNameSingular, recordId,
// workspaceMemberId, l'API `updateOneRecord` et une lecture ONE-SHOT du statut
// courant au moment de l'expiration. L'écriture marche donc même quand la fiche
// (et sa row) ne sont plus montées.
//
// DÉTECTION DE LA FERMETURE : on s'appuie sur le cleanup d'un effet keyé sur
// (recordId, objectNameSingular). Quand le composant se DÉMONTE → fermeture de
// la fiche courante. Quand son `recordId` CHANGE (X → Y, ex. side-panel qui
// bascule de fiche) → l'effet rejoue : son cleanup planifie le décompte de la
// fiche X (fermée), et le nouveau run ne planifie rien (Y vient d'être ouverte ;
// Y ne déclenchera son décompte qu'à SA propre fermeture).

import { useEffect, useRef } from 'react';
import { useStore } from 'jotai';

import { currentWorkspaceMemberState } from '@/auth/states/currentWorkspaceMemberState';
import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { recordStoreFamilySelector } from '@/object-record/record-store/states/selectors/recordStoreFamilySelector';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { isDefined } from 'twenty-shared/utils';

import {
  VERIDIAN_STATUT_COLD_CALL_FIELD,
  buildRecordOpenInput,
  isVeridianRecordOpenObject,
} from '@/veridian-record-open/utils/buildRecordOpenInput';
import {
  buildRecordOpenKey,
  cancelRecordOpen,
  scheduleRecordOpen,
} from '@/veridian-record-open/utils/recordOpenManager';

type VeridianRecordOpenEffectProps = {
  recordId: string;
  objectNameSingular: string;
};

type WriteDeps = {
  workspaceMemberId: string | undefined;
  updateOneRecord: ReturnType<typeof useUpdateOneRecord>['updateOneRecord'];
  store: ReturnType<typeof useStore>;
};

export const VeridianRecordOpenEffect = ({
  recordId,
  objectNameSingular,
}: VeridianRecordOpenEffectProps) => {
  const { updateOneRecord } = useUpdateOneRecord();
  const currentWorkspaceMember = useAtomStateValue(currentWorkspaceMemberState);
  // Store jotai : lecture ONE-SHOT du statut courant AU MOMENT de l'expiration
  // du décompte (pas un abonnement → aucun re-render).
  const store = useStore();

  const workspaceMemberId = currentWorkspaceMember?.id;

  // Ref qui garde toujours la version la PLUS FRAÎCHE des dépendances de
  // l'écriture. Le cleanup d'effet (= fermeture) la lit pour planifier le
  // décompte avec les bonnes valeurs SANS rejouer l'effet à chaque changement
  // de updateOneRecord/store/member (ce qui ré-armerait le décompte à tort).
  const writeDepsRef = useRef<WriteDeps>({
    workspaceMemberId,
    updateOneRecord,
    store,
  });
  writeDepsRef.current = { workspaceMemberId, updateOneRecord, store };

  // Effet keyé sur (recordId, objectNameSingular) UNIQUEMENT : il ne se rejoue
  // QUE quand la fiche affichée change → son cleanup correspond exactement à une
  // FERMETURE de la fiche précédente (changement de recordId OU démontage).
  useEffect(() => {
    const openedRecordId = recordId;
    const openedObject = objectNameSingular;

    // À l'OUVERTURE (mount), on ANNULE tout décompte en cours pour CETTE même
    // fiche. Deux raisons :
    //   1. STRICT MODE (actif en dev, cf AppRouterProviders) : React joue
    //      mount → cleanup → mount. Le cleanup spurious planifierait un décompte
    //      alors que la fiche reste ouverte ; le 2e mount l'annule aussitôt →
    //      pas de fausse confirmation. (En prod, no-op : rien à annuler.)
    //   2. RÉOUVERTURE hors index (URL directe, retour arrière, breadcrumb) :
    //      si la fiche avait été fermée < 10 s avant et qu'on la rouvre par un
    //      chemin qui NE passe PAS par useOpenRecordFromIndexView, on annule
    //      quand même son décompte (la fiche est ré-ouverte, pas "confirmée").
    if (isVeridianRecordOpenObject(openedObject) && isDefined(openedRecordId)) {
      cancelRecordOpen(buildRecordOpenKey(openedObject, openedRecordId));
    }

    // Cleanup = FERMETURE de cette fiche → planifie son décompte de 10 s avec
    // les dépendances d'écriture les plus fraîches disponibles à cet instant.
    return () => {
      const {
        workspaceMemberId: memberId,
        updateOneRecord: update,
        store: jotaiStore,
      } = writeDepsRef.current;

      if (!isVeridianRecordOpenObject(openedObject)) {
        return;
      }
      if (!isDefined(openedRecordId) || openedRecordId === '') {
        return;
      }
      if (!isDefined(memberId)) {
        return;
      }

      const openKey = buildRecordOpenKey(openedObject, openedRecordId);

      scheduleRecordOpen(openKey, () => {
        // Lecture one-shot du statut courant à l'instant de la confirmation → on
        // tranche la progression avec l'état le plus frais (et non au montage).
        const currentStatutColdCall = jotaiStore.get(
          recordStoreFamilySelector.selectorFamily({
            recordId: openedRecordId,
            fieldName: VERIDIAN_STATUT_COLD_CALL_FIELD,
          }),
        ) as string | null | undefined;

        return update({
          objectNameSingular: openedObject,
          idToUpdate: openedRecordId,
          updateOneRecordInput: buildRecordOpenInput(memberId, {
            currentStatutColdCall,
          }),
        });
      });
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [recordId, objectNameSingular]);

  return null;
};
