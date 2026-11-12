# Connexion OAuth native : « redirectUrl mismatch » à la première connexion par le Hub

> **Sévérité** : 🔵 P3 (symptôme corrigé côté app)
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

Cause racine NON trouvée (recherche du 12/11, 23:40) : rien dans notre fork ne réécrit l'URL. Écartés : front
`veridian-hub-login/useRedirectToHubLogin.ts` (`next` = origine + `returnToPath` brut), `auth/hooks/useReturnToPath.ts`,
`pages/auth/Authorize.tsx` (lit `redirect_uri` tel quel), serveur `veridian-hub-sso` (`parseOwnUrl` rend
`pathname + search` d'un `new URL`, `buildMagicLink` et `resolveRedirectUrl` posent `next`/`returnToPath` tels
quels), aucune occurrence de `127.0.0.1` ni de `127\.0` hors tests dans front, shared et server. Le Hub stocke `next`
tel quel (`veridian-hub/lib/auth/bounce-next.ts`, lu par la coordination). Reste à observer le trafic réel du
rebond (journal des redirections Hub → `/auth/hub` → `/verify`) pour trouver le maillon.

## Corrigé côté app (12/11/2026)

`contrat/RetourOAuth.kt` + `Acces.kt` : le client est enregistré avec `127.0.0.1` ET `localhost` sur le même
port, l'échange du code reprend l'adresse appelée (en-tête `Host`). Le symptôme disparaît avec n'importe quel
Twenty ; ce ticket ne garde que la recherche de la cause.

## Correctifs possibles

- **À la source** : le rebond ne doit pas toucher l'URL `next` (la transmettre telle quelle). Préféré.
- **Côté app, en plus** : enregistrer les deux URI de retour (`127.0.0.1` et `localhost`, même port) et échanger le
  code avec celle que le navigateur a réellement appelée (en-tête `Host` de la requête reçue sur le port local).

Prouvé le 13/11/2026 vers 00:05 (heure de Paris) : vrai premier passage (émulateur neuf, aucun cookie, aucune session
Hub ni workspace), APK de la CI 77fab14 : redirect_uri toujours réécrit en localhost par le rebond, « Authorize »
accepté du premier coup, « Connexion prête », SMS au CRM 2,1 s après l'envoi, appel 2,4 s après le raccrochage. La
consigne « touchez une seconde fois » est retirée de la page et du guide.

## Autres frottements du même parcours (pour mémoire)

- Page d'attente Sablier du Hub staging affichée en texte brut (source HTML) dans Chrome Android au premier passage
  (Hub endormi) ; un rechargement suffit. À vérifier : `Content-Type` de la page d'attente.
- Première ouverture de `/authorize` restée blanche (racine React vide, ressources en statut 0) sur un téléphone lent ;
  un rechargement suffit.
