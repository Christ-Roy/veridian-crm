// Veridian — module AGPL (fork twentyhq/twenty). Mécanique "ouverture de fiche"
// (cf veridian-tunnel-de-vente/docs/VISION-INSTANCE-TWENTY-CUSTOM.md §4).
//
// Composant monté dans la vue d'une fiche (Company/Person) — PLEINE PAGE
// (RecordShowPage) ET SIDE-PANEL (SidePanelRecordPage). Au mount d'une fiche :
//   - démarre un timer de 5s + affiche l'indicateur visuel de la FENÊTRE
//     D'ANNULATION (glow + barre de progression) ;
//   - si la fiche est refermée / change de recordId AVANT 5s → annule, n'écrit
//     RIEN, retire l'indicateur (= clic par erreur / prospect n'a pas décroché,
//     cf VISION §4.1.3) ;
//   - si la fiche reste ouverte ≥ 5s → écrit `ficheOuverteAt` + le commercial
//     dans `ficheOuverteParId` via l'API update, et fait progresser
//     `statutColdCall` A_APPELER → FICHE_OUVERTE (jamais de régression d'une
//     fiche déjà travaillée, cf VISION §4.1.2 + garde Robert 2026-06-17).
//
// DÉ-DOUBLONNAGE side-panel ⟷ pleine page : la même fiche peut être montée 2×
// SIMULTANÉMENT (un commercial qui ouvre l'aperçu en side-panel PUIS la pleine
// page). Chaque instance a son timer, mais l'ÉCRITURE est sérialisée par une
// garde MODULE-LEVEL partagée (`recordOpenGuard`) keyée par
// `<objectNameSingular>:<recordId>` : la première instance qui confirme réclame
// la clé, toute autre confirmation concurrente de la même fiche est ignorée. La
// garde par `useRef` (locale) reste comme court-circuit intra-instance.
//
// Le composant rend l'indicateur (overlay absolu) pendant la fenêtre, sinon null.

import { useEffect, useRef, useState } from 'react';
import { useStore } from 'jotai';

import { currentWorkspaceMemberState } from '@/auth/states/currentWorkspaceMemberState';
import { useUpdateOneRecord } from '@/object-record/hooks/useUpdateOneRecord';
import { recordStoreFamilySelector } from '@/object-record/record-store/states/selectors/recordStoreFamilySelector';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { useSetAtomState } from '@/ui/utilities/state/jotai/hooks/useSetAtomState';
import { isDefined } from 'twenty-shared/utils';

import { VeridianRecordOpenIndicator } from '@/veridian-record-open/components/VeridianRecordOpenIndicator';
import { veridianActiveOpenKeyState } from '@/veridian-record-open/states/veridianActiveOpenKeyState';
import {
  VERIDIAN_RECORD_OPEN_DELAY_MS,
  VERIDIAN_STATUT_COLD_CALL_FIELD,
  buildRecordOpenInput,
  isVeridianRecordOpenObject,
} from '@/veridian-record-open/utils/buildRecordOpenInput';
import {
  buildRecordOpenKey,
  claimRecordOpen,
  confirmRecordOpen,
  releaseRecordOpen,
} from '@/veridian-record-open/utils/recordOpenGuard';

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
  // Atom global réactif : signale à la LIGNE de la fiche dans la vue table
  // qu'elle est en fenêtre d'annulation (→ animation de la row, point (c)).
  const setActiveOpenKey = useSetAtomState(veridianActiveOpenKeyState);
  // Store jotai : lecture ONE-SHOT du statut courant au moment de la
  // confirmation (pas un abonnement → aucun re-render, pas de re-trigger
  // de l'effet quand le statut change).
  const store = useStore();

  const workspaceMemberId = currentWorkspaceMember?.id;

  // Garde d'idempotence LOCALE : la clé de la dernière ouverture confirmée par
  // CETTE instance. Court-circuit rapide (re-render / effet rejoué sans
  // changement de recordId). La garde module-level couvre le multi-instance.
  const confirmedOpenKeyRef = useRef<string | null>(null);

  // Fenêtre d'annulation active → affiche l'indicateur. Repasse à false à la
  // confirmation (5s) OU à l'annulation (cleanup avant 5s).
  const [isCancellationWindowOpen, setIsCancellationWindowOpen] =
    useState(false);

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

    const openKey = buildRecordOpenKey(objectNameSingular, recordId);

    // Déjà confirmée pour cette fiche par cette instance → rien.
    if (confirmedOpenKeyRef.current === openKey) {
      return;
    }

    let cancelled = false;

    // Ouvre la fenêtre d'annulation (indicateur visuel des 5s) : overlay local
    // (side-panel/pleine page) + atom global (anime la row dans la vue table).
    setIsCancellationWindowOpen(true);
    setActiveOpenKey(openKey);

    // Remet l'atom global à null SI — et seulement si — c'est toujours notre
    // clé qui est active (ne pas écraser la fenêtre d'une autre fiche ouverte
    // entre-temps). L'arrêt de l'animation de la row en découle.
    const clearActiveOpenKeyIfOurs = () =>
      setActiveOpenKey((current) => (current === openKey ? null : current));

    const timeoutId = setTimeout(() => {
      if (cancelled) {
        return;
      }

      // Fin de la fenêtre d'annulation → l'indicateur disparaît (local + row).
      setIsCancellationWindowOpen(false);
      clearActiveOpenKeyIfOurs();

      // Marque LOCALEMENT avant l'appel async pour bloquer un re-déclenchement
      // intra-instance.
      confirmedOpenKeyRef.current = openKey;

      // DÉ-DOUBLONNAGE multi-instance : réclame l'écriture au niveau module.
      // Si une autre instance (side-panel ⟷ pleine page) a déjà réclamé /
      // confirmé cette fiche → on n'écrit pas (mais l'indicateur a quand même
      // signalé la fenêtre, ce qui est le comportement voulu côté UX).
      if (!claimRecordOpen(openKey)) {
        return;
      }

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
      })
        .then(() => {
          confirmRecordOpen(openKey);
        })
        .catch(() => {
          // L'update a échoué → on relâche les deux gardes pour réessayer à la
          // prochaine ouverture confirmée de cette même fiche.
          if (confirmedOpenKeyRef.current === openKey) {
            confirmedOpenKeyRef.current = null;
          }
          releaseRecordOpen(openKey);
        });
    }, VERIDIAN_RECORD_OPEN_DELAY_MS);

    // Cleanup : fiche refermée / recordId change AVANT 5s → annule, n'écrit
    // rien, retire l'indicateur (local + row).
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      setIsCancellationWindowOpen(false);
      clearActiveOpenKeyIfOurs();
    };
  }, [
    recordId,
    objectNameSingular,
    workspaceMemberId,
    updateOneRecord,
    store,
    setActiveOpenKey,
  ]);

  if (!isCancellationWindowOpen) {
    return null;
  }

  return <VeridianRecordOpenIndicator />;
};
