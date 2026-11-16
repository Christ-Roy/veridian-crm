import { defineObject, FieldType } from 'twenty-sdk/define';

import { REUNION_MEET_FIELDS as F, REUNION_MEET_UNIVERSAL_IDENTIFIER, STATUT_OPTION_IDS as S } from '../identifiants';

// Un Meet créé depuis le CRM : de quoi retrouver sa séance chez Google (code de réunion), les fiches où écrire
// son compte rendu (cibles) et où en est l'import (statut). Une ligne par événement Google, jamais deux.
export default defineObject({
  universalIdentifier: REUNION_MEET_UNIVERSAL_IDENTIFIER,
  nameSingular: 'reunionMeet',
  namePlural: 'reunionMeets',
  labelSingular: 'Réunion Meet',
  labelPlural: 'Réunions Meet',
  description: 'Google Meet créé depuis le CRM et état de son compte rendu',
  icon: 'IconVideo',
  labelIdentifierFieldMetadataUniversalIdentifier: F.titre,
  fields: [
    { universalIdentifier: F.titre, type: FieldType.TEXT, name: 'titre', label: 'Titre', icon: 'IconAbc' },
    { universalIdentifier: F.debut, type: FieldType.DATE_TIME, name: 'debut', label: 'Début', icon: 'IconCalendarClock' },
    { universalIdentifier: F.fin, type: FieldType.DATE_TIME, name: 'fin', label: 'Fin', icon: 'IconCalendarCheck' },
    { universalIdentifier: F.lienMeet, type: FieldType.LINKS, name: 'lienMeet', label: 'Lien Meet', icon: 'IconVideo' },
    {
      universalIdentifier: F.codeReunion,
      type: FieldType.TEXT,
      name: 'codeReunion',
      label: 'Code de réunion',
      description: 'abc-defg-hij : clé de la séance dans l’API Google Meet',
      icon: 'IconHash',
    },
    {
      universalIdentifier: F.idEvenementGoogle,
      type: FieldType.TEXT,
      name: 'idEvenementGoogle',
      label: 'Événement Google',
      icon: 'IconCalendar',
    },
    { universalIdentifier: F.icalUid, type: FieldType.TEXT, name: 'icalUid', label: 'iCalUID', icon: 'IconCalendar' },
    {
      universalIdentifier: F.participants,
      type: FieldType.TEXT,
      name: 'participants',
      label: 'Invités',
      icon: 'IconUsers',
    },
    {
      universalIdentifier: F.cibles,
      type: FieldType.RAW_JSON,
      name: 'cibles',
      label: 'Fiches reliées',
      description: 'Personnes, sociétés et dossiers où la note du Meet est posée',
      icon: 'IconLink',
    },
    {
      universalIdentifier: F.statut,
      type: FieldType.SELECT,
      name: 'statut',
      label: 'Compte rendu',
      icon: 'IconProgressCheck',
      isNullable: false,
      defaultValue: "'PLANIFIEE'",
      options: [
        { id: S.PLANIFIEE, value: 'PLANIFIEE', label: 'Planifiée', position: 0, color: 'blue' },
        { id: S.EN_ATTENTE, value: 'EN_ATTENTE', label: 'En attente', position: 1, color: 'orange' },
        { id: S.IMPORTEE, value: 'IMPORTEE', label: 'Importé', position: 2, color: 'green' },
        { id: S.SANS_TRANSCRIPTION, value: 'SANS_TRANSCRIPTION', label: 'Sans transcription', position: 3, color: 'gray' },
        { id: S.NON_TENUE, value: 'NON_TENUE', label: 'Non tenue', position: 4, color: 'red' },
      ],
    },
    { universalIdentifier: F.noteId, type: FieldType.TEXT, name: 'noteId', label: 'Note', icon: 'IconNotes' },
    {
      universalIdentifier: F.compteGoogle,
      type: FieldType.TEXT,
      name: 'compteGoogle',
      label: 'Agenda Google',
      icon: 'IconBrandGoogle',
    },
    {
      universalIdentifier: F.dernierEssai,
      type: FieldType.DATE_TIME,
      name: 'dernierEssai',
      label: 'Dernier import',
      icon: 'IconRefresh',
    },
    {
      universalIdentifier: F.detailImport,
      type: FieldType.TEXT,
      name: 'detailImport',
      label: 'Détail de l’import',
      icon: 'IconInfoCircle',
    },
    {
      universalIdentifier: F.lienEnregistrement,
      type: FieldType.LINKS,
      name: 'lienEnregistrement',
      label: 'Enregistrement',
      icon: 'IconPlayerPlay',
    },
  ],
});
