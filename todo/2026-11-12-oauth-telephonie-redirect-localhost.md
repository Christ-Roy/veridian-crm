# Connexion OAuth native : « redirectUrl mismatch » à la première connexion par le Hub

> **Sévérité** : 🟡 P1
> **Owner** : agent veridian-crm (SSO Hub) ; contournement possible côté app Téléphonie CRM
> **Créé** : 2026-11-12

## Constat (mesuré le 12/11/2026 vers 23:00, émulateur Android 16, workspace staging magical-mint-octopus)

Parcours d'un inconnu depuis https://veridian.site/telephonie : APK installé par Chrome, « Se connecter avec
Twenty ». L'utilisateur n'a pas encore de session sur son workspace, donc le CRM rebondit par le Hub. Historique de
l'onglet Chrome, dans l'ordre :

1. `/authorize?...&redirect_uri=http://127.0.0.1:44297/retour&...` (ce qu'envoie l'app, `Acces.kt` l.150)
2. Hub (`/api/auth/bounce/prepare`, connexion), puis `/verify?loginToken=…`
3. `/authorize?...&redirect_uri=http://localhost:44297/retour&...` : **127.0.0.1 réécrit en localhost**

« Authorize » répond alors `redirectUrl mismatch for '<client_id>'` : le client a été enregistré (RFC 7591)
avec `http://127.0.0.1:44297/retour` seulement. Le second essai, session ouverte, garde `127.0.0.1` et passe
(« Connexion prête »). Tout client du CRM Veridian qui connecte son téléphone pour la première fois tombe dessus.

Non trouvé dans `core-modules/veridian-hub-sso` ni dans `twenty-front/src/modules/auth` : la réécriture se fait
entre l'aller vers le Hub et `/verify` (paramètre `next` / `returnToPath`). À chercher côté Hub (`bounce`).

## Correctifs possibles

- **À la source** : le rebond ne doit pas toucher l'URL `next` (la transmettre telle quelle). Préféré.
- **Côté app, en plus** : enregistrer les deux URI de retour (`127.0.0.1` et `localhost`, même port) et échanger le
  code avec celle que le navigateur a réellement appelée (en-tête `Host` de la requête reçue sur le port local).

En attendant, la page https://veridian.site/telephonie (étape 4) dit de toucher une seconde fois « Se connecter avec
Twenty ». À retirer une fois corrigé.

## Autres frottements du même parcours (pour mémoire)

- Page d'attente Sablier du Hub staging affichée en texte brut (source HTML) dans Chrome Android au premier passage
  (Hub endormi) ; un rechargement suffit. À vérifier : `Content-Type` de la page d'attente.
- Première ouverture de `/authorize` restée blanche (racine React vide, ressources en statut 0) sur un téléphone lent ;
  un rechargement suffit.
