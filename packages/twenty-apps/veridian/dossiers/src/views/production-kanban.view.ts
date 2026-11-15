import { defineView } from 'twenty-sdk/define';

import { VUES_TACHES } from '../identifiants';
import { vueTaches } from '../utils/vues-taches.util';

export default defineView(vueTaches({ id: VUES_TACHES.IA_KANBAN, nom: 'Production · priorités', nature: 'IA', kanban: true, position: 13 }));
