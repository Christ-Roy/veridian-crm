
## Avancement 2026-06-13 — Billing OFF propagé en PROD ✅

**Point 4 (module billing désactivé) : FAIT en prod.**

- `IS_BILLING_ENABLED: "true"` → `"false"` sur les 2 services du compose prod
  (`infra/dokploy/prod/docker-compose.yml` crm-server + crm-worker), commit
  `aece58f63` (staging CI verte 7m23s), promu main par ff le 2026-06-13.
- Deploy Dokploy manuel (webhook autoDeploy ne recreate pas sur simple changement
  de compose — `compose.deploy` composeId `8zdqAAD1lkZFVAwuZ5USv`). Recreate confirmé.
- **Vérifs prod** : `IS_BILLING_ENABLED=false` effectif dans server + worker ;
  `/healthz`=200 ET `/metadata`=200 (vrai boot) ; workspace commercial
  `veridian.crm.app.veridian.site`=200.
- **Preuve fonctionnelle** : workflow natif de promotion (cold-call → Person+Opp)
  re-testé en réel dans le workspace Tunnel Lab → `promu=true` + Opportunity
  "BillingOff Test" stage NEW créée. Avant ce fix les workflows plantaient sur
  `BillingException: No active subscription found`. Records de test nettoyés.
- **Drift schéma billing** corrigé en amont le 2026-06-11 (2 colonnes
  `billingPrice.metadata`, `billingCustomer.creditBalanceMicro`).

Reste du ticket (points 2, 3, 5, 6) = chantier de fond non bloquant pour le
tunnel. Le verrou qui gênait (billing gate workflows) est levé.
