import { defineApplication } from 'twenty-sdk/define';

import { APPLICATION_UNIVERSAL_IDENTIFIER } from './identifiants';

export default defineApplication({
  universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
  displayName: 'Google Meet',
  description:
    'Crée un Google Meet depuis une personne, une société ou un dossier (événement d’agenda, invités, note sur les fiches), puis importe le compte rendu : participants, durée, enregistrement et transcription.',
  serverVariables: {
    GOOGLE_CLIENT_ID: {
      description: 'ID client OAuth Google (projet Google Cloud veridian-crm-8013, client « Veridian CRM Web »).',
      isSecret: false,
      isRequired: true,
    },
    GOOGLE_CLIENT_SECRET: {
      description: 'Secret de ce client OAuth. Chiffré par Twenty, jamais rendu par l’API.',
      isSecret: true,
      isRequired: true,
    },
  },
});
