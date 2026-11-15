# Sauvegarde froide avant modification en masse : tâches, dossiers, devis, dépendances (veridian-4).
import json, os, sys, time
sys.path.insert(0, '.')
from tw import *

etiquette = sys.argv[1]
d = {
    'date': time.strftime('%Y-%m-%dT%H:%M:%S%z'),
    'tasks': tout('tasks', 'id title status dueAt importance suiviType suiviQui suiviAvancement rangementId assigneeId position'),
    'dossiers': tout('dossiers', 'id nom categorie importance parentId societeId'),
    'devis': tout('devisListe', 'id numero dossierId statut encaissement montantEncaisse'),
    'dependances': tout('dependances', 'id tacheId prerequisId libelle'),
}
chemin = os.path.expanduser(f'~/backups-froid/crm-veridian4-{etiquette}-{time.strftime("%Y%m%d-%H%M")}.json')
json.dump(d, open(chemin, 'w'), ensure_ascii=False, indent=1)
os.chmod(chemin, 0o600)
print(chemin, {k: len(v) for k, v in d.items() if isinstance(v, list)})
