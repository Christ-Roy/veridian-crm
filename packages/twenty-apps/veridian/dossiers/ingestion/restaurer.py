# Remet l'essai du navigateur à l'état d'origine : Google Meet en IA, lien de dépendance d'essai détruit.
import sys
sys.path.insert(0, '.')
from tw import *
from collections import Counter

meet = tout('tasks', 'id title nature', '{ title: { like: "Intégrer Google Meet%" } }')[0]
gql('mutation($id: UUID!) { updateTask(id: $id, data: { nature: IA }) { id } }', {'id': meet['id']})
for d in tout('dependances', 'id libelle'):
    print('lien d essai', d['libelle'])
    gql('mutation($id: UUID!) { destroyDependance(id: $id) { id } }', {'id': d['id']})
t = tout('tasks', 'id nature status')
print('taches', len(t), Counter(x['nature'] for x in t), 'dependances', len(tout('dependances', 'id')),
      'devis', len(tout('devisListe', 'id')), 'dossiers', len(tout('dossiers', 'id')))
