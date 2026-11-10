import { defineApplication } from 'twenty-sdk/define';

import { APPLICATION_UNIVERSAL_IDENTIFIER } from './identifiants';

export default defineApplication({
  universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
  displayName: 'Téléphonie Veridian',
  description:
    'Appels (enregistrement et transcription) et SMS rattachés aux personnes, visibles dans leur timeline',
});
