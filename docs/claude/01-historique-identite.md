# Historique de la stratégie d'identité

Décision du 26/05/2026, remplacée le 06/11/2026 par le Hub seule source d'identité.

**Décision Robert 2026-05-26** : Veridian CRM tourne en **standalone**, sans
intégration au contrat Hub. Pas de HMAC m2m, pas de provisioning Hub→CRM, pas
d'`update-plan` webhook, pas de `magic-link` cross-app, pas d'audit log GDPR
maison, pas de SSO/SAML clean room.

**Raison** : Twenty est conçu pour tourner seul. Il a son propre login
(email+password + Google OAuth + Microsoft OAuth), son propre admin panel,
ses propres magic links internes (via `AppToken`), son propre billing
(qu'on désactive parce qu'on facture autrement), son propre subdomain par
workspace. Forcer Twenty à se plier au contrat Hub coûterait ~150h-agent
pour un gain quasi nul à ce stade. On garde Twenty natif.

**Conséquence sur l'archi** :

- L'utilisateur s'inscrit/se logge **directement** sur le CRM Veridian
  (`crm.veridian.site` ou subdomain par client)
- Pas d'auth bouncée depuis le Hub
- Pas de tenant provisionné par le Hub
- Le billing client = via le canal Veridian habituel (Stripe direct ou
  facturation manuelle pour les premiers clients consulting), mais **pas
  via le module billing Twenty interne** (qui est 100% EE)

Les audits `docs/spec/AUDIT-CONFORMITE-HUB.md` et `AUDIT-TWENTY-MICRO.md`
restent en archive comme **référence si un jour la stratégie évolue**, pas
comme spec à implémenter.

### Si Robert pivote (futur)

Si un jour l'intégration Hub redevient nécessaire (genre Phase 2 quand le
CRM aura 5+ clients), réexhumer `AUDIT-CONFORMITE-HUB.md` qui contient le
plan détaillé (~115-150h-agent, 10 lots L1→L10).
