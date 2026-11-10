"""Dossier de la barre latérale : un objet et une entrée par valeur d'un de ses champs SELECT.

    crm-telephonie dossier --env prod --workspace veridian-4 [--objet person] [--champ etiquette] [--nom People]

Donne « People ▸ Tous les contacts, Famille, Perso, Pro, À trier » : l'entrée native de l'objet passe dans le
dossier, et chaque valeur du champ reçoit une vue filtrée (colonnes de la vue principale) et son entrée. Les
valeurs sont lues dans le CRM à chaque lancement : une étiquette ajoutée y apparaît au rejeu suivant. Rien n'est
supprimé ; un rejeu ne crée que ce qui manque. Un dossier Twenty s'ouvre et se ferme, il ne navigue pas :
« Tous les contacts » est sa première entrée. Tout passe par l'API de métadonnées native (vues et menu du
workspace), pas par l'app, parce que le champ appartient au workspace (import des contacts), pas à l'app.
"""
import json

LIBELLE_TOUS = "Tous les contacts"


def _metadonnees(twenty, requete, variables=None):
    reponse = twenty.requete("POST", "/metadata", {"query": requete, "variables": variables or {}})
    if reponse.get("errors"):
        raise RuntimeError(reponse["errors"][0].get("message", "")[:300])
    return reponse["data"]


def _objet(twenty, nom_objet):
    donnees = _metadonnees(twenty, "{ objects(paging:{first:500}, filter:{}) { edges { node { id nameSingular "
                                   "labelPlural fieldsList { id name label type options } } } } }")
    for arete in donnees["objects"]["edges"]:
        if arete["node"]["nameSingular"] == nom_objet:
            return arete["node"]
    raise RuntimeError(f"objet {nom_objet} absent du workspace")


def plan_dossier(objet, champ, vues, filtres_par_vue, elements, nom_dossier):
    """Ce qui manque, calculé sans écrire : vues à créer, dossier, entrées. Pur, testé sans réseau."""
    options = sorted(champ.get("options") or [], key=lambda o: o.get("position", 0))
    vues_objet = [v for v in vues if v["objectMetadataId"] == objet["id"]]
    vue_par_valeur = {}
    for vue in vues_objet:
        for filtre in filtres_par_vue.get(vue["id"], []):
            if filtre["fieldMetadataId"] == champ["id"] and filtre["operand"] == "IS":
                valeurs = json.loads(filtre["value"]) if isinstance(filtre["value"], str) else filtre["value"]
                if isinstance(valeurs, list) and len(valeurs) == 1:
                    vue_par_valeur.setdefault(valeurs[0], vue["id"])
    dossier = next((e for e in elements if e["type"] == "FOLDER" and e.get("name") == nom_dossier), None)
    entree_objet = next((e for e in elements if e["type"] == "OBJECT" and e.get("targetObjectMetadataId") == objet["id"]
                         and not e.get("userWorkspaceId")), None)
    vues_dans_dossier = {e.get("viewId") for e in elements if dossier and e.get("folderId") == dossier["id"]}
    return {
        "options": options,
        "vues_a_creer": [o for o in options if o["value"] not in vue_par_valeur],
        "vue_par_valeur": vue_par_valeur,
        "dossier": dossier,
        "entree_objet": entree_objet,
        "entrees_a_creer": [o for o in options if vue_par_valeur.get(o["value"]) not in vues_dans_dossier
                            or o["value"] not in vue_par_valeur],
    }


def organiser(twenty, nom_objet="person", nom_champ="etiquette", nom_dossier="People", essai=False):
    objet = _objet(twenty, nom_objet)
    champ = next((f for f in objet["fieldsList"] if f["name"] == nom_champ), None)
    if not champ or champ["type"] not in ("SELECT", "MULTI_SELECT"):
        raise RuntimeError(f"champ SELECT {nom_objet}.{nom_champ} absent")
    vues = _metadonnees(twenty, "{ getViews { id name key position objectMetadataId } }")["getViews"]
    filtres = {}
    for vue in vues:
        if vue["objectMetadataId"] == objet["id"]:
            filtres[vue["id"]] = _metadonnees(twenty, "query($v:String!){ getViewFilters(viewId:$v){ id fieldMetadataId "
                                                       "operand value } }", {"v": vue["id"]})["getViewFilters"]
    elements = _metadonnees(twenty, "{ navigationMenuItems { id type name viewId targetObjectMetadataId folderId "
                                    "position userWorkspaceId } }")["navigationMenuItems"]
    plan = plan_dossier(objet, champ, vues, filtres, elements, nom_dossier)
    print(f"{nom_objet}.{nom_champ} : {len(plan['options'])} valeurs ({', '.join(o['label'] for o in plan['options'])}) ; "
          f"{len(plan['vues_a_creer'])} vues à créer, dossier {'présent' if plan['dossier'] else 'à créer'}, "
          f"{len(plan['entrees_a_creer'])} entrées à ajouter")
    if essai:
        return 0
    principale = next((v for v in vues if v["objectMetadataId"] == objet["id"] and v.get("key") == "INDEX"), None)
    colonnes = _metadonnees(twenty, "query($v:String!){ getViewFields(viewId:$v){ fieldMetadataId position isVisible "
                                    "size } }", {"v": principale["id"]})["getViewFields"] if principale else []
    for option in plan["vues_a_creer"]:
        vue = _metadonnees(twenty, "mutation($i:CreateViewInput!){ createView(input:$i){ id } }",
                           {"i": {"name": option["label"], "objectMetadataId": objet["id"], "type": "TABLE",
                                  "icon": "IconTag", "visibility": "WORKSPACE"}})["createView"]
        vues.append({"id": vue["id"], "position": 0})
        if colonnes:
            _metadonnees(twenty, "mutation($i:[CreateViewFieldInput!]!){ createManyViewFields(inputs:$i){ id } }",
                         {"i": [dict(c, viewId=vue["id"]) for c in colonnes]})
        _metadonnees(twenty, "mutation($i:CreateViewFilterInput!){ createViewFilter(input:$i){ id } }",
                     {"i": {"viewId": vue["id"], "fieldMetadataId": champ["id"], "operand": "IS",
                            "value": json.dumps([option["value"]])}})
        plan["vue_par_valeur"][option["value"]] = vue["id"]
    # À position égale, Twenty peut ouvrir une vue filtrée au clic sur l'objet : la vue principale reste en tête.
    base = principale["position"] if principale else 0
    for rang, option in enumerate(plan["options"], start=1):
        identifiant = plan["vue_par_valeur"][option["value"]]
        position = next((v["position"] for v in vues if v["id"] == identifiant), None)
        if position is None or position <= base:
            _metadonnees(twenty, "mutation($i:String!,$u:UpdateViewInput!){ updateView(id:$i, input:$u){ id } }",
                         {"i": identifiant, "u": {"position": base + 10 + rang}})
    dossier = plan["dossier"]
    if dossier is None:
        position = plan["entree_objet"]["position"] if plan["entree_objet"] else 0
        dossier = _metadonnees(twenty, "mutation($i:CreateNavigationMenuItemInput!){ createNavigationMenuItem(input:$i)"
                                       "{ id } }", {"i": {"type": "FOLDER", "name": nom_dossier, "icon": "IconUser",
                                                           "position": position}})["createNavigationMenuItem"]
    entree_objet = plan["entree_objet"]
    if entree_objet and entree_objet.get("folderId") != dossier["id"]:
        _metadonnees(twenty, "mutation($i:UpdateOneNavigationMenuItemInput!){ updateNavigationMenuItem(input:$i){ id } }",
                     {"i": {"id": entree_objet["id"], "update": {"folderId": dossier["id"], "position": 0,
                                                                 "name": LIBELLE_TOUS}}})
    for rang, option in enumerate(plan["options"], start=1):
        if option in plan["entrees_a_creer"]:
            _metadonnees(twenty, "mutation($i:CreateNavigationMenuItemInput!){ createNavigationMenuItem(input:$i)"
                                 "{ id } }", {"i": {"type": "VIEW", "viewId": plan["vue_par_valeur"][option["value"]],
                                                    "folderId": dossier["id"], "position": rang}})
    return 0
