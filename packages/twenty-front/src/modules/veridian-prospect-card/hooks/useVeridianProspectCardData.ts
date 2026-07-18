// Veridian — module AGPL. Lecture des champs du record company pour le cockpit
// "fiche prospect". AUCUN refetch : le store jotai est déjà peuplé par
// `RecordShowEffect` (monté juste au-dessus dans PageLayoutRecordPageRenderer).
// On lit champ par champ via `recordStoreFamilySelector` (réactif, pattern
// SummaryCard) + l'état de chargement via `useRecordShowContainerData`.

import {
  type FieldEmailsValue,
  type FieldLinksValue,
  type FieldPhonesValue,
} from '@/object-record/record-field/ui/types/FieldMetadata';
import { useRecordShowContainerData } from '@/object-record/record-show/hooks/useRecordShowContainerData';
import { recordStoreFamilySelector } from '@/object-record/record-store/states/selectors/recordStoreFamilySelector';
import { useAtomFamilySelectorValue } from '@/ui/utilities/state/jotai/hooks/useAtomFamilySelectorValue';

import {
  VERIDIAN_PROSPECT_CARD_FIELDS,
  VERIDIAN_STATUT_COLD_CALL_FIELD,
} from '@/veridian-prospect-card/utils/veridianProspectCardFields';

const useField = <T,>(recordId: string, fieldName: string): T =>
  useAtomFamilySelectorValue(recordStoreFamilySelector, {
    recordId,
    fieldName,
  }) as T;

export type VeridianProspectCardData = {
  isLoading: boolean;
  name: string | null;
  phones: FieldPhonesValue | null;
  emails: FieldEmailsValue | null;
  domainName: FieldLinksValue | null;
  hasWebsite: boolean | null;
  siteWebUrl: string | null;
  effectifs: number | null;
  employees: number | null;
  secteur: string | null;
  codeNaf: string | null;
  departement: string | null;
  commune: string | null;
  codePostal: string | null;
  siren: string | null;
  prospectScore: number | null;
  statutColdCall: string | null;
};

export const useVeridianProspectCardData = (
  recordId: string,
): VeridianProspectCardData => {
  const { recordLoading } = useRecordShowContainerData({
    objectRecordId: recordId,
  });

  const F = VERIDIAN_PROSPECT_CARD_FIELDS;

  return {
    isLoading: recordLoading,
    name: useField<string | null>(recordId, F.name) ?? null,
    phones: useField<FieldPhonesValue | null>(recordId, F.phones) ?? null,
    emails: useField<FieldEmailsValue | null>(recordId, F.emails) ?? null,
    domainName:
      useField<FieldLinksValue | null>(recordId, F.domainName) ?? null,
    hasWebsite: useField<boolean | null>(recordId, F.hasWebsite) ?? null,
    siteWebUrl: useField<string | null>(recordId, F.siteWebUrl) ?? null,
    effectifs: useField<number | null>(recordId, F.effectifs) ?? null,
    employees: useField<number | null>(recordId, F.employees) ?? null,
    secteur: useField<string | null>(recordId, F.secteur) ?? null,
    codeNaf: useField<string | null>(recordId, F.codeNaf) ?? null,
    departement: useField<string | null>(recordId, F.departement) ?? null,
    commune: useField<string | null>(recordId, F.commune) ?? null,
    codePostal: useField<string | null>(recordId, F.codePostal) ?? null,
    siren: useField<string | null>(recordId, F.siren) ?? null,
    prospectScore: useField<number | null>(recordId, F.prospectScore) ?? null,
    statutColdCall:
      useField<string | null>(recordId, VERIDIAN_STATUT_COLD_CALL_FIELD) ??
      null,
  };
};
