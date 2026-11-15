import { defineView } from 'twenty-sdk/define';

import { VUES_TACHES } from '../identifiants';
import { vueTaches } from '../utils/vues-taches.util';

export default defineView(vueTaches({ id: VUES_TACHES.HUMAIN_KANBAN, nom: 'Tâches · priorités', nature: 'HUMAIN', kanban: true, position: 11 }));
