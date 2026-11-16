import { defineFrontComponent } from 'twenty-sdk/define';
import { Command, enqueueSnackbar } from 'twenty-sdk/front-component';

import { IMPORT_GLOBAL_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER } from '../identifiants';
import { importerComptesRendus } from '../twenty/actions';
import { connexionPourMoi } from '../twenty/connexions';
import { messageErreur } from '../twenty/graphql';
import { listerReunions } from '../twenty/reunions';

// Commande de palette : importe les comptes rendus de tous les Meet passés non clos, puis le dit en un toast.

const importerTout = async (): Promise<void> => {
  try {
    const choix = await connexionPourMoi();
    if (choix.etat !== 'OK') {
      await enqueueSnackbar({
        message: 'Google Meet : connecte (ou reconnecte) Google dans Réglages > Applications > Google Meet.',
        variant: 'error',
      });
      return;
    }
    const b = await importerComptesRendus(choix.connexion, await listerReunions());
    if (b.aReconnecter) {
      await enqueueSnackbar({ message: 'Google refuse la connexion : reconnecte Google dans les réglages de l’app.', variant: 'error' });
      return;
    }
    await enqueueSnackbar({
      message:
        b.tentees === 0
          ? 'Aucun Meet passé à importer.'
          : `Comptes rendus Meet : ${b.importees} importé(s), ${b.enAttente} en attente${b.erreurs.length ? `, ${b.erreurs.length} en erreur (${b.erreurs[0]})` : ''}.`,
      variant: b.erreurs.length ? 'error' : 'success',
    });
  } catch (e) {
    await enqueueSnackbar({ message: `Import Meet impossible : ${messageErreur(e)}`, variant: 'error' });
  }
};

const ImportGlobal = () => <Command execute={importerTout} />;

export default defineFrontComponent({
  universalIdentifier: IMPORT_GLOBAL_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  name: 'import-comptes-rendus-meet',
  description: 'Importe les comptes rendus de tous les Google Meet passés créés depuis le CRM',
  component: ImportGlobal,
  isHeadless: true,
});
