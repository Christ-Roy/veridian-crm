# Import des 25 devis du registre (~/Bureau/comptabilité/README.md, « ### Devis »), des dossiers Prospection
# manquants, puis classement nature / événement à prévoir des 131 tâches. Idempotent : relançable sans doublon.
import json, re, sys, time
sys.path.insert(0, '.')
from tw import *

# Société CRM -> préfixe d'identifiant (relevé le 15/11) ; nom du dossier Prospection à créer s'il manque.
SOC = {
    'AM': '8df2b7cf', 'MOREL': 'c5b73535', 'MILLIRIS': '910b4577', 'CHATEX': '8d2a1bc1', 'MAG': 'e659fa61',
    'SUBSOL': '0643eb23', 'SIRPE': 'c6d35239', 'AVSE': '4e487839', 'ASD': 'ce0aa0de', 'LEADDY': 'ebcddfa1',
    'GREEN': '2d955146',
}
NOUVEAUX = {
    'JAMFYM': ('46b7e1ad-7ecd-4d00-a7e2-dfcee565ab1b', "L'Aquarium de Steph (JAMFYM)"),
    'NRYAN': ('9dc3cf11-3c6d-4413-be75-7f7d9e51da45', 'N-RYAN'),
    'DJAMS': ('7f3a2137-8c8d-4c79-ae8e-25482cfd3535', 'Djams Débarrassage'),
    'FGMC': ('34845867-7285-4347-8b89-5b83d39be9c2', 'France Générale Machines à Coudre'),
    'RETOUR': ('f6c7dad7-76bc-479d-98d8-c5caa1703090', "RETOUR D'EST (Serre Chevalier Shop)"),
    'CASA': ('a82b5f9e-973e-4e45-a2bb-7a3b89e488b3', 'CASA SOFIA'),
    'SUPPORTERS': ('e6f179d2-2ebc-4e8a-b2fe-ca417e9c3bf5', 'SUPPORTERS CLUB DE FRANCE'),
}
IDX = 'Index compta (README.md, arrêté au 8/09)'
C05 = 'CIC …001, export du 05/09'
C10 = 'CIC …001, export du 10/11 (période 01/09-10/11)'
# numero, date, clé société, objet, montant, statut, encaissement, montant encaissé, preuve
DEVIS = [
    ('2026-001', '2026-04-11', 'AM', 'Création site', 500, 'ENVOYE', 'PARTIEL', 250,
     'Chèque de 250 € remis le 29/04/2026 (bilan xlsx onglet Encaissements, fiche CRM relevée au 10/11/2026), égal à l’acompte de 50 % ; aucune facture à l’index. Statut du devis à vérifier auprès de la cliente (index).'),
    ('2026-002', '2026-04-11', 'AM', 'Hébergement et maintenance, 20 € net par mois', None, 'ENVOYE', 'NON_VERIFIE', None,
     f'Aucune échéance facturée ({IDX}) ; rien au relevé {C10}.'),
    ('2026-003', '2026-04-13', 'MOREL', 'Création site', 600, 'SIGNE', 'TOTAL', 600,
     f'F001 (16/04) et F002 (23/04) payées ({IDX}) ; fiche CRM Morel TOUT_PROUVE au 10/11/2026 (bilan xlsx).'),
    ('2026-004', '2026-04-13', 'MOREL', 'Hébergement et maintenance, 120 € net par an', 120, 'SIGNE', 'TOTAL', 120,
     f'F003 (23/04) payée, période 2026-2027 ({IDX}) ; fiche CRM TOUT_PROUVE au 10/11/2026. Renouvellement annuel via ce devis.'),
    ('2026-005', '2026-04-22', 'MILLIRIS', 'Listing prospection bois', 200, 'SIGNE', 'TOTAL', 200,
     f'F005 (29/04) ({IDX}) ; fiche CRM Milliris TOUT_PROUVE au 10/11/2026 (bilan xlsx).'),
    ('2026-006', '2026-05-11', 'CHATEX', 'Création site (+ options), 2 500 € à 10 000 € net', None, 'SIGNE', 'PARTIEL', 4500,
     f'F013 1 000 € le 16/06 et F018 1 500 € le 30/07 ({C05}) ; F022 2 000 € le 25/09 ({C10}). L’index (8/09) dit F018 et F022 en attente : périmé.'),
    ('2026-007', '2026-05-11', 'CHATEX', 'Hébergement et maintenance, 120 € à 1 140 € net par an', None, 'ENVOYE', 'NON_VERIFIE', None,
     'Mise en route proposée par mail le 06/11/2026 à 1 140 € HT par an, pas d’accord reçu (fiche CRM au 10/11/2026).'),
    ('2026-008', '2026-04-19', 'MAG', 'Création site', 2500, 'ENVOYE', 'NON_VERIFIE', None,
     f'1 500 € payés selon Robert (05/09/2026, prix négocié), absents du relevé {C10} : non prouvé. Index : signature en attente.'),
    ('2026-009', '2026-04-19', 'MAG', 'Hébergement et maintenance, 600 € net par an', 600, 'REFUSE', 'AUCUN', None,
     'Maintenance abandonnée sans frais (fiche CRM La Mag’audière, 10/11/2026) : rien d’exigible.'),
    ('2026-010', '2026-05-23', 'SUBSOL', 'Rapatriement site, 300 € HT (360 € TTC)', 300, 'SIGNE', 'TOTAL', 300,
     f'108 € TTC le 27/05 (F011) et 252 € TTC le 12/06 (F012), {C05}. L’index dit F012 en attente : périmé. Montants HT, le relevé porte 360 € TTC.'),
    ('2026-011', '2026-05-25', 'SIRPE', 'Boîte mail pro sur sirpe.fr', 100, 'SIGNE', 'TOTAL', 100,
     f'Virement « SIRPE 2026-F010 » le 14/06 ({C05}).'),
    ('2026-012', '2026-05-28', 'AVSE', 'Maintenance site + CMS, 25 € net par mois (300 € par an)', 300, 'SIGNE', 'PARTIEL', 50,
     f'25 € le 22/07 (F015, {C05}) et 25 € le 11/09 (F020, {C10}) ; F025 et F028 sans virement au 10/11 (le client écrit le 09/11 que le virement est parti). Échéances portées ici, pas sur 2026-017.'),
    ('2026-013', '2026-05-28', 'JAMFYM', 'Location site internet tout compris, 150 € de mise en route + 30 € net par mois', None, 'BROUILLON', 'NON_VERIFIE', None,
     f'Devis à transmettre à Stéphane Mérieux ({IDX}) ; aucune facture.'),
    ('2026-014', '2026-05-28', 'NRYAN', 'Création site n-ryan.fr (acompte symbolique 30 €)', 1500, 'BROUILLON', 'NON_VERIFIE', None,
     f'Devis à transmettre à Faouzi Trabelsi ({IDX}) ; aucune facture.'),
    ('2026-015', '2026-05-28', 'DJAMS', 'Création site djams-debarassage.fr + hébergement an 1', 1290, 'BROUILLON', 'NON_VERIFIE', None,
     f'Devis à transmettre à Djamel Kazi-Tani ({IDX}) ; site en ligne, aucune facture. Virements de M. Guilhem Jacquet (500 € le 25/07, 12 € le 02/08, {C05}) sans facture : lien avec ce dossier non établi.'),
    ('2026-016', '2026-06-20', 'FGMC', 'Refonte e-commerce, socle 8 000 € net (+ options)', 8000, 'BROUILLON', 'NON_VERIFIE', None,
     f'Devis à présenter en rendez-vous chez le dirigeant ({IDX}) ; aucune facture.'),
    ('2026-017', '2026-06-22', 'AVSE', 'Échéancier maintenance mensuelle, 25 € net × 12 (réf. 2026-012)', 300, 'SIGNE', 'NON_VERIFIE', None,
     'Échéancier du devis 2026-012 : les encaissements sont portés sur 2026-012, pour ne pas les compter deux fois.'),
    ('2026-018', '2026-06-25', 'ASD', 'Site e-commerce (Medusa + abonnement + Dolibarr), socle ; option suivi Ads 2 000 €', 22500, 'SIGNE', 'PARTIEL', 15750,
     f'F019 6 750 € le 19/08 ({C05}) et F029 9 000 € le 05/11 ({C10}). L’index (8/09) dit F019 et F029 en attente : périmé ; la fiche CRM (TOUT_PROUVE) a raison.'),
    ('2026-019', '2026-06-25', 'ASD', 'Hébergement et gestion mensuelle 290 € + option avis ISO 20488 99 € par mois', None, 'ENVOYE', 'NON_VERIFIE', None,
     'Démarre à la mise en ligne, aucune échéance facturée (fiche CRM ASD au 10/11/2026). Signature à confirmer.'),
    ('2026-020', '2026-07-24', 'RETOUR', 'Création du site e-commerce Serre Chevalier Shop', 8000, 'REMPLACE', 'AUCUN', None,
     f'Remplacé par 2026-024, jamais envoyé ({IDX}) : rien d’exigible.'),
    ('2026-021', '2026-08-04', 'LEADDY', 'Environnement IA + workflows Elementor et Google Ads (signé le 05/08)', 1500, 'SIGNE', 'PARTIEL', 1150,
     f'1 150 € le 01/10 libellé « 2026-F024 » ({C10}). L’index remplace F024 par F026 (607,50 €) et l’avoir sur F024 reste à émettre : encaissé supérieur au facturé en vigueur.'),
    ('2026-022', '2026-10-08', 'CASA', 'Click & collect WooCommerce + Stripe : 1 490 € ou 2 090 € net', None, 'BROUILLON', 'NON_VERIFIE', None,
     f'Brouillon Gmail non envoyé ({IDX}).'),
    ('2026-023', '2026-10-08', 'SUPPORTERS', 'Optimisation de la boutique PrestaShop : 2 490 € ou 3 290 € net', None, 'BROUILLON', 'NON_VERIFIE', None,
     f'Brouillon Gmail non envoyé ({IDX}).'),
    ('2026-024', '2026-10-26', 'RETOUR', 'Site e-commerce Serre Chevalier Shop, version révisée : 4 000 € net + 7,5 % des ventes', 4000, 'BROUILLON', 'NON_VERIFIE', None,
     f'Remplace 2026-020. Brouillon Lark non envoyé ({IDX}) ; rien au relevé {C10}.'),
    ('2026-025', '2026-10-30', 'GREEN', 'Abonnement emailing de prospection, 200 € net par mois (600 € par trimestre)', None, 'BROUILLON', 'PARTIEL', 600,
     f'600 € le 31/10 libellé « T1 MAILING OCT 2026 » ({C10}), égal à un trimestre ; aucune facture à l’index, devis encore en brouillon à l’index.'),
]

dossiers = tout('dossiers', 'id nom categorie parentId societeId')
par_societe = {d['societeId']: d for d in dossiers if d['societeId'] and not d['parentId']}
cle_dossier = {}
for cle, prefixe in SOC.items():
    d = next(d for sid, d in par_societe.items() if sid.startswith(prefixe))
    cle_dossier[cle] = d['id']
for cle, (sid, nom) in NOUVEAUX.items():
    if sid in par_societe:
        cle_dossier[cle] = par_societe[sid]['id']
        continue
    r = gql('mutation($d: DossierCreateInput!) { createDossier(data: $d) { id } }',
            {'d': {'nom': nom, 'categorie': 'PROSPECTION', 'importance': 'NORMALE', 'societeId': sid}})
    cle_dossier[cle] = r['createDossier']['id']
    print('dossier créé', nom)
    time.sleep(0.7)

existants = {d['numero']: d['id'] for d in tout('devisListe', 'id numero')}
for num, date, cle, objet, montant, statut, enc, mt_enc, preuve in DEVIS:
    data = {'numero': num, 'dateDevis': date, 'objet': objet, 'montant': montant, 'statut': statut,
            'encaissement': enc, 'montantEncaisse': mt_enc, 'preuve': preuve, 'dossierId': cle_dossier[cle]}
    if num in existants:
        gql('mutation($id: UUID!, $d: DevisUpdateInput!) { updateDevis(id: $id, data: $d) { id } }', {'id': existants[num], 'd': data})
    else:
        gql('mutation($d: DevisCreateInput!) { createDevis(data: $d) { id } }', {'d': data})
    time.sleep(0.7)
print('devis', len(tout('devisListe', 'id')))

# Classement des tâches. Règle explicite, dans l'ordre ; tout cas non couvert reste HUMAIN et est signalé.
taches = tout('tasks', 'id title suiviType suiviQui rangementId')
noms = {d['id']: d['nom'] for d in tout('dossiers', 'id nom')}
asd = [p for p in tout('people', 'id name { firstName } company { name }', '{ company: { name: { eq: "ANIMAL SERVICES DISTRIBUTION" } } }')]
contact = {p['name']['firstName']: p['id'] for p in asd if p['name']['firstName'] in ('Hugo', 'Romain')}

def classer(t):
    titre, qui, dossier = t['title'] or '', t['suiviQui'], noms.get(t['rangementId'], '')
    if re.match(r'^R\d+ ·', titre) or qui == 'ROBERT':
        return 'HUMAIN', 'AUCUN', None, 'décision de Robert (R…)'
    if re.match(r'^A\d+ ·', titre) or qui == 'ASD':
        nom = next((n for n in ('Hugo', 'Romain') if n in titre), None)
        return 'HUMAIN', 'APPEL', contact.get(nom), 'action attendue du client ASD : Robert relance ou arbitre (A…)'
    if re.match(r'^[NJ]\d+ ·', titre) or qui == 'NOUS':
        return 'IA', 'AUCUN', None, 'production Veridian (N…) ou jalon de production (J…)'
    if titre.startswith('Demo'):
        return 'IA', 'AUCUN', None, 'démo de site produite par IA'
    if titre.startswith('Rappel ') or titre.startswith('Relance '):
        return 'HUMAIN', 'APPEL', None, 'rappel ou relance de prospect par Robert'
    if dossier in ('CRM', 'Réseau de la flotte (Tailscale-WireGuard)'):
        return 'IA', 'AUCUN', None, 'chantier technique exécuté par agents'
    if dossier == 'Matériel et téléphones':
        return 'HUMAIN', 'AUCUN', None, 'geste physique de Robert'
    return 'HUMAIN', 'AUCUN', None, 'NON COUVERT'

AMBIGUES = re.compile(r'^(A\d+|J1|J2|J5|J6|N8|N10) ·|Flash Alarm|Samsung')
groupes = {}
for t in taches:
    nature, besoin, aqui, regle = classer(t)
    cle = (nature, besoin, aqui)
    groupes.setdefault(cle, []).append(t['id'])
    t['_r'] = (nature, besoin, regle)
for (nature, besoin, aqui), ids in groupes.items():
    data = {'nature': nature, 'besoinAgenda': besoin}
    if aqui:
        data['aContacterId'] = aqui
    gql('mutation($ids: [UUID!]!, $d: TaskUpdateInput!) { updateTasks(filter: { id: { in: $ids } }, data: $d) { id } }', {'ids': ids, 'd': data})
    print(f'{nature:6} {besoin:11} contact={bool(aqui)} : {len(ids)} tâches')
print('\nAMBIGUES')
for t in taches:
    if AMBIGUES.search(t['title'] or '') or t['_r'][2] == 'NON COUVERT':
        print(f"  {t['_r'][0]:6} {t['_r'][1]:6} {t['title'][:90]}  [{t['_r'][2]}]")
