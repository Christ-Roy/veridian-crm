// Veridian — module AGPL (fork twentyhq/twenty). Mécanique "ouverture de fiche"
// (cf veridian-tunnel-de-vente/docs/VISION-INSTANCE-TWENTY-CUSTOM.md §4).
//
// Composant Effect monté dans la vue pleine page d'une fiche (RecordShowPage,
// PAS le side-panel pour éviter le double-montage). Au mount d'une fiche :
//   - démarre un timer de 5s ;
//   - si la fiche est refermée / change de recordId AVANT 5s → annule, n'écrit
//     RIEN (= clic par erreur / prospect n'a pas décroché, cf VISION §4.1.3) ;
//   - si la fiche reste ouverte ≥ 5s → écrit `ficheOuverteAt` + le commercial
//     dans `ficheOuverteParId` via l'API update (une seule écriture par
//     ouverture confirmée — idempotence par ref) ; et fait progresser
//     `statutColdCall` A_APPELER → FICHE_OUVERTE (jamais de régression d'une
//     fiche déjà travaillée, cf VISION §4.1.2 + garde Robert 2026-06-17).
//
// Le composant ne rend rien (return null) — c'est un effet de présence.

import { useEffect, useRef } from 'react';
import { useStore } from 'jotai';

import { currentWorkspaceMemberState } from '@/auth/states/currentWorkspaceMemberState';
import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { recordStoreFamilySelector } from '@/object-record/record-store/states/selectors/recordStoreFamilySelector';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { isDefined } from 'twenty-shared/utils';

import {
  VERIDIAN_RECORD_OPEN_DELAY_MS,
  VERIDIAN_STATUT_COLD_CALL_FIELD,
  buildRecordOpenInput,
  isVeridianRecordOpenObject,
} from '@/veridian-record-open/utils/buildRecordOpenInput';

type VeridianRecordOpenEffectProps = {
  recordId: string;
  objectNameSingular: string;
};

export const VeridianRecordOpenEffect = ({
  recordId,
  objectNameSingular,
}: VeridianRecordOpenEffectProps) => {
  const { updateOneRecord } = useUpdateOneRecord();
  const currentWorkspaceMember = useAtomStateValue(currentWorkspaceMemberState);
  // Store jotai : lecture ONE-SHOT du statut courant au moment de la
  // confirmation (pas un abonnement → aucun re-render, pas de re-trigger
  // de l'effet quand le statut change).
  const store = useStore();

  const workspaceMemberId = currentWorkspaceMember?.id;

  // Garde d'idempotence : la clé de la dernière ouverture confirmée écrite.
  // Évite toute ré-écriture en boucle (re-render, effet rejoué sans changement
  // de recordId).
  const confirmedOpenKeyRef = useRef<string | null>(null);

  useEffect(() => {
    // On ne déclenche que sur les objets qui portent les champs d'ouverture
    // (Company / Person). Autre objet → no-op.
    if (!isVeridianRecordOpenObject(objectNameSingular)) {
      return;
    }

    if (!isDefined(recordId) || recordId === '') {
      return;
    }

    if (!isDefined(workspaceMemberId)) {
      return;
    }

    const openKey = `${objectNameSingular}:${recordId}`;

    // Déjà confirmée pour cette fiche pendant cette session de montage → rien.
    if (confirmedOpenKeyRef.current === openKey) {
      return;
    }

    let cancelled = false;

    const timeoutId = setTimeout(() => {
      if (cancelled) {
        return;
      }

      // Marque AVANT l'appel async pour bloquer tout re-déclenchement concurrent.
      confirmedOpenKeyRef.current = openKey;

      // Lecture one-shot du statut courant à l'instant de la confirmation
      // (et non au mount) → on tranche la progression avec l'état le plus frais.
      const currentStatutColdCall = store.get(
        recordStoreFamilySelector.selectorFamily({
          recordId,
          fieldName: VERIDIAN_STATUT_COLD_CALL_FIELD,
        }),
      ) as string | null | undefined;

      void updateOneRecord({
        objectNameSingular,
        idToUpdate: recordId,
        updateOneRecordInput: buildRecordOpenInput(workspaceMemberId, {
          currentStatutColdCall,
        }),
      }).catch(() => {
        // L'update a échoué → on relâche la garde pour réessayer à la
        // prochaine ouverture confirmée de cette même fiche.
        if (confirmedOpenKeyRef.current === openKey) {
          confirmedOpenKeyRef.current = null;
        }
      });
    }, VERIDIAN_RECORD_OPEN_DELAY_MS);

    // Cleanup : fiche refermée / recordId change AVANT 5s → annule, n'écrit rien.
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [recordId, objectNameSingular, workspaceMemberId, updateOneRecord, store]);

  return null;
};
