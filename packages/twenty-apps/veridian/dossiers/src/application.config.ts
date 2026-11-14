import { defineApplication } from 'twenty-sdk/define';

import { APPLICATION_UNIVERSAL_IDENTIFIER } from './identifiants';

export default defineApplication({
  universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
  displayName: 'Dossiers Veridian',
  description: 'Les tâches rangées en arborescence : sujet, sous-sujet, puis tâches (champ Dossier des tâches)',
});
