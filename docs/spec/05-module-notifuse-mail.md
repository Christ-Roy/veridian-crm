# 05 — Module Veridian-Mail (push campagnes mail depuis CRM vers Notifuse)

> Module ajouté au CRM forké qui permet d'envoyer des mails au nom du commercial (sender qualifié = Notifuse Gmail OAuth) **directement depuis les Workflows Twenty**.

## Pattern

```
User CRM dans workspace
  └─ Crée un Workflow Twenty : "Quand Deal passe en stage Won, envoyer mail X au contact"
  └─ Workflow exécution
     └─ Action "Send Email via Veridian"
        └─ Backend CRM HMAC vers Notifuse :
           POST notifuse.app.veridian.site/api/campaigns/send-from-crm
           Headers HMAC (CRM_NOTIFUSE_API_SECRET)
           Body {
             workspace_id,
             from_user_id,           ← user CRM = même hub_user_id que Notifuse
             to_email,
             subject,
             body_html,
             body_text,
             template_slug?,
             variables?,
             idempotency_key
           }
        └─ Notifuse envoie via SMTP/Gmail Hub Gateway (réutilise W7a)
        └─ Notifuse webhook → CRM : status mail (delivered, bounced, opened, clicked)
        └─ CRM stocke dans Object "MailEvent" + lie au Deal/Contact concerné
```

## Composants à coder côté CRM

### Backend

```
apps/twenty-server/src/modules/veridian-mail/
├── veridian-mail.module.ts
├── veridian-mail.service.ts          ← HMAC client vers Notifuse
├── workflows/send-email-action.workflow.ts  ← Action dispo dans le UI Workflow Twenty
└── webhooks/notifuse-status.controller.ts   ← POST endpoint webhook (signature HMAC)
```

### Frontend

L'action "Send Email via Veridian" apparaît nativement dans le Workflow Builder Twenty.

## Composants à coder côté Notifuse

### Nouvelle route HMAC

```go
// internal/api/campaigns/send_from_crm.go
// Auth: HMAC contre CRM_NOTIFUSE_API_SECRET
// Body: { workspace_id, from_user_id, to_email, subject, body_html, ... }
// Return: { message_id, sent_at, idempotent_replay }
```

### Webhook vers CRM

Quand Notifuse reçoit un événement (delivered/bounced/opened/clicked), il push vers le CRM :
```
POST crm.app.veridian.site/api/webhooks/notifuse-mail-status
Headers HMAC
Body { message_id, event: 'delivered' | 'bounced' | 'opened' | 'clicked', timestamp }
```

### Ticket cross-app Notifuse

Déposer dans `notifuse-veridian/todo/` :
`2026-05-25-campaigns-send-from-crm-route.md`

## Estimation

- Backend module CRM : 2-3 jours
- Action Workflow Twenty : 1-2 jours
- Route Notifuse + webhook : 2-3 jours
- Tests E2E hard-core : 1 jour
- **Total : ~1 semaine (1 agent)**
