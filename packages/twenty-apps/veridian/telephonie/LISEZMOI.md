# Téléphonie CRM : vos appels et SMS dans votre Twenty

L'application Android **Téléphonie CRM** envoie elle-même à votre CRM Twenty chaque appel, SMS et MMS du
téléphone, quelques secondes après qu'il a eu lieu. Chaque échange se range dans la fiche de la personne
(onglets Appels et SMS, fil d'activité). Aucun ordinateur n'est nécessaire côté téléphone.

Il vous faut :

- un téléphone Android 12 ou plus récent ;
- un Twenty (Twenty Cloud ou installé chez vous), version 2.56 ou plus récente ;
- pour l'étape 1 seulement, un compte administrateur de ce Twenty.

## 1. Ajouter l'app « Téléphonie » à votre Twenty (une fois, par un administrateur)

Elle crée dans Twenty les objets **Appels** et **SMS**, leurs onglets sur les fiches Personne et le rôle
**Téléphone**.

- **CRM Veridian** : déjà disponible, rien à faire.
- **Autre Twenty** (Cloud ou installé ailleurs), depuis un ordinateur avec Node.js 24 :
  1. Téléchargez `telephonie-twenty-app.tgz` sur la page
     <https://github.com/Christ-Roy/veridian-crm/releases/tag/telephonie-android> et décompressez-le.
  2. Dans Twenty : Paramètres, API et webhooks, créez une clé API au rôle **Admin** (vous la supprimerez
     juste après).
  3. Dans le dossier `telephonie`, lancez (remplacez l'adresse et la clé) :

     ```bash
     corepack yarn install
     TWENTY_API_URL=https://votre-espace.twenty.com TWENTY_API_KEY=la-cle-admin corepack yarn twenty app apply --no-prune --no-input --create
     ```

  4. Supprimez la clé Admin dans Paramètres, API et webhooks.

## 2. Installer l'application sur le téléphone

1. Sur le téléphone, ouvrez ce lien :
   <https://github.com/Christ-Roy/veridian-crm/releases/download/telephonie-android/telephonie-crm.apk>
2. Ouvrez le fichier téléchargé. Android demande d'autoriser votre navigateur à installer des applications :
   acceptez, puis touchez **Installer**.

## 3. Connecter le téléphone à votre Twenty

1. Ouvrez **Téléphonie CRM**.
2. Tapez l'adresse de votre Twenty (par exemple `monentreprise.twenty.com`).
3. Touchez **Se connecter avec Twenty**. Le navigateur s'ouvre : connectez-vous comme d'habitude, puis touchez
   **Authorize**.
4. Touchez **Revenir à Téléphonie CRM**. L'écran affiche « Connexion prête » et la liste des vérifications.

Vous préférez donner au téléphone un accès limité aux seuls appels et SMS ? Créez dans Twenty une clé API
(Paramètres, API et webhooks, Créer une clé) avec le rôle **Téléphone**, puis collez-la dans le champ
« Clé API » de l'application, ou scannez-la en QR, et touchez **Tester la connexion**.

## 4. Autoriser l'application

Touchez **Accorder les autorisations** et acceptez chaque demande (journal d'appels, SMS, contacts, téléphone,
notifications). Touchez aussi **Ne pas endormir l'app**.

Si Android répond que le réglage est restreint : ouvrez les informations de l'application (l'app vous y
emmène), menu **⋮** en haut à droite, **Autoriser les paramètres restreints**, puis accordez les autorisations.

## 5. Activer l'envoi

L'application démarre en **mode essai** : elle lit tout, mais n'écrit rien dans Twenty. Activez
**Envoyer au CRM**, puis choisissez depuis quand : tout l'historique du téléphone, les 30 derniers jours, ou
à partir de maintenant. C'est tout : chaque nouvel appel ou SMS part tout seul.

## Options (facultatives)

- **Transcription des appels enregistrés** : faite sur le téléphone, sans rien envoyer à un service extérieur.
  L'application télécharge une fois un modèle de 640 Mo, en Wi-Fi seulement, depuis Hugging Face, et vérifie
  son empreinte avant de s'en servir.
- **Enregistrements d'appels** : installez l'application JemRec (F-Droid) et autorisez l'accès aux fichiers
  depuis Téléphonie CRM. Les enregistrements partent alors avec leurs appels.
- **Messagerie vocale** (avancé) : Android la réserve aux applications système. Le bouton **Comment activer la
  messagerie vocale** explique la marche à suivre, sur le téléphone lui-même.

Tout le reste fonctionne sans ces options.

## « Reconnecter à Twenty »

Si l'accès est retiré (connexion révoquée, clé supprimée, ou téléphone resté hors ligne plus de 60 jours),
une notification **Reconnecter à Twenty** reste affichée. Rien n'est perdu : les appels et SMS attendent sur
le téléphone. Touchez la notification, reconnectez-vous : tout part, sans doublon.

## Ce qui sort du téléphone

Les appels, SMS, MMS et enregistrements vont **uniquement** vers votre Twenty. Le seul autre accès réseau est
le téléchargement du modèle de transcription, si vous l'activez.
