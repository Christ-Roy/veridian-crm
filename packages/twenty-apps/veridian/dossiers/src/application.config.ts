import { defineApplication } from 'twenty-sdk/define';

import { APPLICATION_UNIVERSAL_IDENTIFIER } from './identifiants';

export default defineApplication({
  universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
  displayName: 'Dossiers Veridian',
  description: 'Projets en arbre et en Gantt, devis et encaissé prouvé, dépendances, tâches de Robert et Production',
});
