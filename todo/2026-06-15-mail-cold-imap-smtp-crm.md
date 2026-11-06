# Brancher l'infra mail cold au CRM (lire/répondre les échanges prospects)

> **Sévérité** : 🟡 P1 (use case commercial actif — Robert 2026-06-15)
> **Owner** : agent veridian-crm
> **Créé** : 2026-06-15

## Fait le 2026-06-15
✅ Boîte Lark robert.brunon@veridian.site branchée en IMAP+SMTP sur le tenant
prod (connectedAccountId ea4de532-714b-4715-bc8c-303d75cf4dc2). Policy
contactAutoCreationPolicy=SENT (seuls les destinataires de mails sortants
deviennent contacts → pas de pollution par le perso reçu) + visibility=
SHARE_EVERYTHING (partage contenu avec collègues). Import 738 mails en cours.
Helper: ~/.claude/skills/admin-twenty/iac/scripts/connect-imap-smtp-caldav.py.
⚠️ Boîte MIXTE perso/business: surveiller que SHARE_EVERYTHING n'expose pas trop
de perso aux collègues; repli possible visibility=SUBJECT.

## Reste à faire
1. **Postfix local (cold mailer) en SMTP** → permettre de répondre/envoyer aux
   prospects via l'infra cold (bonne délivrabilité, même domaine que l'envoi initial).
   Brancher comme compte connecté supplémentaire (multi-provider natif Twenty, OK).
2. **IMAP des boîtes cold dédiées** (ex agences-veridian.fr) → capter les RÉPONSES
   entrantes des prospects dans la timeline. Ces boîtes sont 100% prospection (zéro
   perso) → on peut passer SENT_AND_RECEIVED sans risque (vs la boîte Lark mixte).
   Approche reco (Robert hésitait): brancher l'IMAP cold, policy SENT_AND_RECEIVED,
   visibility SHARE_EVERYTHING.
3. Vérifier la délivrabilité réponse depuis le CRM (le SMTP du compte connecté
   est utilisé par message-outbound-manager/drivers/imap).

## Capacité confirmée (lecture code 2026-06-15)
Twenty supporte plusieurs ConnectedAccount par workspace (aucune limite trouvée),
provider IMAP_SMTP_CALDAV générique (n'importe quel serveur), lecture (import-manager)
+ envoi/réponse (outbound-manager driver imap). Use case complet faisable nativement,
zéro dev, juste connecter les comptes par API.
