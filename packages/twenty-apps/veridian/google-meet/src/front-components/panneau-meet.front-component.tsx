import { type CSSProperties, type SyntheticEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { defineFrontComponent } from 'twenty-sdk/define';
import { closeSidePanel, enqueueSnackbar, unmountFrontComponent, useSelectedObjectMetadata, useSelectedRecordIds } from 'twenty-sdk/front-component';
import { useTheme } from 'twenty-ui/theme';

import { PANNEAU_MEET_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER } from '../identifiants';
import { type BilanImport, creerMeet, importerComptesRendus } from '../twenty/actions';
import { connexionPourMoi } from '../twenty/connexions';
import { chargerContexte, type ContexteFiche } from '../twenty/fiches';
import { messageErreur } from '../twenty/graphql';
import { listerReunions, type Reunion, reunionsDeLaFiche } from '../twenty/reunions';
import type { EvenementCree, ObjetCible, StatutReunion } from '../types/meet.types';
import type { ChoixConnexion } from '../utils/choisir-connexion.util';
import { aImporter } from '../utils/compte-rendu.util';
import { creneauParDefaut, formatDateHeure } from '../utils/creneau.util';
import { decouperSaisie, normaliserEmails } from '../utils/emails.util';
import { validerDemande } from '../utils/evenement-calendar.util';
import { nouvelIdEvenement } from '../utils/identifiant-stable.util';

// Panneau latéral « Créer un Meet » d'une personne, d'une société ou d'un dossier : formulaire de création,
// puis la liste des Meet de la fiche. À l'ouverture, les Meet passés sans compte rendu sont importés.

const OBJETS: ReadonlyArray<ObjetCible> = ['person', 'company', 'dossier'];
const DUREES = [15, 30, 45, 60, 90, 120];
const LIBELLE_STATUT: Record<StatutReunion, string> = {
  PLANIFIEE: 'Planifiée',
  EN_ATTENTE: 'Compte rendu en attente',
  IMPORTEE: 'Compte rendu importé',
  SANS_TRANSCRIPTION: 'Sans transcription',
  NON_TENUE: 'Non tenue',
};

// Le bac à sable des front components transmet la valeur saisie sous plusieurs formes selon l'élément.
const valeur = (e: SyntheticEvent<HTMLElement>): string | undefined => {
  const o = e as unknown as { detail?: { value?: unknown }; value?: unknown; target?: { value?: unknown } };
  for (const v of [o.detail?.value, o.value, o.target?.value]) if (typeof v === 'string') return v;
  return undefined;
};
const surSaisie = (f: (v: string) => void) => (e: SyntheticEvent<HTMLElement>) => {
  const v = valeur(e);
  if (v !== undefined) f(v);
};

const texteBilan = (b: BilanImport): string => {
  if (b.aReconnecter) return 'Google refuse la connexion : reconnecte Google dans Réglages > Applications > Google Meet.';
  if (b.tentees === 0) return 'Aucun Meet passé à importer.';
  const parts = [`${b.importees} importé(s)`, `${b.enAttente} en attente`];
  if (b.erreurs.length) parts.push(`${b.erreurs.length} en erreur : ${b.erreurs.join(' ; ')}`);
  return `Comptes rendus : ${parts.join(', ')}.`;
};

const PanneauMeet = () => {
  const theme = useTheme();
  const ids = useSelectedRecordIds();
  const objetMeta = useSelectedObjectMetadata();
  const objet = OBJETS.find((o) => o === objetMeta?.nameSingular) ?? null;
  const recordId = ids.length > 0 ? ids[0] : null;

  const [connexion, setConnexion] = useState<ChoixConnexion | null>(null);
  const [contexte, setContexte] = useState<ContexteFiche | null>(null);
  const [erreurChargement, setErreurChargement] = useState<string | null>(null);
  const [reunions, setReunions] = useState<Reunion[]>([]);

  const creneau = useMemo(() => creneauParDefaut(Date.now()), []);
  const [titre, setTitre] = useState('');
  const [date, setDate] = useState(creneau.date);
  const [heure, setHeure] = useState(creneau.heure);
  const [duree, setDuree] = useState('30');
  const [coches, setCoches] = useState<Set<string>>(new Set());
  const [autres, setAutres] = useState('');
  const [envoyer, setEnvoyer] = useState(true);
  const [envoi, setEnvoi] = useState(false);
  const [cree, setCree] = useState<EvenementCree | null>(null);
  const idEvenement = useRef(nouvelIdEvenement());
  const [importEnCours, setImportEnCours] = useState(false);
  const [bilan, setBilan] = useState<string | null>(null);
  const importAuto = useRef(false);

  const cible = useMemo(() => (objet && recordId ? { objet, id: recordId } : null), [objet, recordId]);

  const rechargerReunions = useCallback(async () => {
    if (!cible) return [];
    const toutes = await listerReunions();
    const miennes = reunionsDeLaFiche(toutes, cible);
    setReunions(miennes);
    return miennes;
  }, [cible]);

  const importer = useCallback(
    async (liste: Reunion[], choix: ChoixConnexion | null) => {
      if (!choix || choix.etat !== 'OK') return;
      setImportEnCours(true);
      try {
        const b = await importerComptesRendus(choix.connexion, liste);
        setBilan(texteBilan(b));
        if (b.aReconnecter) setConnexion(await connexionPourMoi());
        await rechargerReunions();
      } catch (e) {
        setBilan(`Import impossible : ${messageErreur(e)}`);
      } finally {
        setImportEnCours(false);
      }
    },
    [rechargerReunions],
  );

  useEffect(() => {
    if (!cible) return;
    let actif = true;
    (async () => {
      try {
        const [ctx, choix, miennes] = await Promise.all([chargerContexte(cible.objet, cible.id), connexionPourMoi(), rechargerReunions()]);
        if (!actif) return;
        setContexte(ctx);
        setConnexion(choix);
        setTitre(`Échange Veridian · ${ctx.nom}`);
        setCoches(new Set(ctx.invites.map((i) => i.email)));
        const maintenant = Date.now();
        if (!importAuto.current && miennes.some((r) => aImporter(r, maintenant))) {
          importAuto.current = true;
          await importer(miennes, choix);
        }
      } catch (e) {
        if (actif) setErreurChargement(messageErreur(e));
      }
    })();
    return () => {
      actif = false;
    };
  }, [cible, rechargerReunions, importer]);

  const saisieAutres = decouperSaisie(autres);
  const emails = normaliserEmails([...coches, ...saisieAutres.emails]);
  const demande = {
    titre,
    description: contexte ? `Rendez-vous Veridian · ${contexte.nom}` : '',
    date,
    heure,
    dureeMinutes: Number(duree),
    emails,
    idEvenement: idEvenement.current,
    fuseau: 'Europe/Paris',
  };
  const erreurs = [...validerDemande(demande), ...saisieAutres.refuses.map((r) => `Adresse refusée : ${r}`)];
  const peutCreer = connexion?.etat === 'OK' && contexte !== null && erreurs.length === 0 && !envoi;

  const creer = async () => {
    if (!peutCreer || connexion?.etat !== 'OK' || !contexte) return;
    setEnvoi(true);
    try {
      const r = await creerMeet({ connexion: connexion.connexion, demande, envoyerInvitations: envoyer, cibles: contexte.cibles });
      if (!r.ok) {
        await enqueueSnackbar({ message: r.message, variant: 'error' });
        if (/reconnecte/i.test(r.message)) setConnexion(await connexionPourMoi());
        return;
      }
      setCree(r.evenement);
      await enqueueSnackbar({ message: `Meet créé : ${r.evenement.lienMeet}`, variant: 'success' });
      await rechargerReunions();
    } catch (e) {
      await enqueueSnackbar({ message: `Meet non créé : ${messageErreur(e)}`, variant: 'error' });
    } finally {
      setEnvoi(false);
    }
  };

  const fermer = () => {
    unmountFrontComponent();
    closeSidePanel();
  };

  const s = {
    racine: { fontFamily: 'inherit', fontSize: 13, color: theme.font.color.primary, padding: 16, display: 'flex', flexDirection: 'column', gap: 12, boxSizing: 'border-box', width: '100%' },
    bloc: { border: `1px solid ${theme.border.color.medium}`, borderRadius: 8, padding: 12, display: 'flex', flexDirection: 'column', gap: 8, background: theme.background.primary },
    label: { fontSize: 12, color: theme.font.color.secondary, display: 'flex', flexDirection: 'column', gap: 4 },
    champ: { font: 'inherit', fontSize: 13, color: theme.font.color.primary, background: theme.background.secondary, border: `1px solid ${theme.border.color.medium}`, borderRadius: 6, padding: '6px 8px', width: '100%', boxSizing: 'border-box' },
    ligne: { display: 'flex', gap: 8, flexWrap: 'wrap' },
    bouton: { font: 'inherit', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 6, padding: '8px 14px', cursor: 'pointer', background: theme.color.blue, color: '#fff' },
    boutonOff: { opacity: 0.5, cursor: 'not-allowed' },
    secondaire: { font: 'inherit', fontSize: 12, borderRadius: 6, padding: '6px 10px', cursor: 'pointer', background: 'transparent', color: theme.font.color.secondary, border: `1px solid ${theme.border.color.medium}` },
    note: { fontSize: 12, color: theme.font.color.tertiary },
    erreur: { fontSize: 12, color: theme.color.red },
    lien: { color: theme.color.blue, textDecoration: 'underline', wordBreak: 'break-all' },
    case: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 },
  } satisfies Record<string, CSSProperties>;

  if (!cible) return <div style={s.racine}>Ouvre une personne, une société ou un dossier, puis « Créer un Meet ».</div>;
  if (erreurChargement) return <div style={s.racine}><span style={s.erreur}>Chargement impossible : {erreurChargement}</span></div>;
  if (!contexte || !connexion) return <div style={s.racine}>Chargement…</div>;

  const basculer = (email: string) =>
    setCoches((prec) => {
      const n = new Set(prec);
      if (n.has(email)) n.delete(email);
      else n.add(email);
      return n;
    });

  return (
    <div style={s.racine}>
      <div style={{ fontSize: 15, fontWeight: 600 }}>Google Meet · {contexte.nom}</div>

      {connexion.etat === 'ABSENTE' && (
        <div style={s.bloc}>
          <span style={s.erreur}>Aucun compte Google connecté à l’app.</span>
          <span style={s.note}>Réglages &gt; Applications &gt; Google Meet &gt; Connexions : « Ajouter une connexion », une seule fois.</span>
        </div>
      )}
      {connexion.etat === 'A_RECONNECTER' && (
        <div style={s.bloc}>
          <span style={s.erreur}>La connexion Google ({connexion.connexion.handle ?? 'compte'}) a expiré ou a été refusée.</span>
          <span style={s.note}>Réglages &gt; Applications &gt; Google Meet &gt; Connexions : « Reconnecter ».</span>
        </div>
      )}

      {cree ? (
        <div style={s.bloc}>
          <span style={{ fontWeight: 600 }}>Meet créé dans l’agenda {connexion.etat === 'OK' ? connexion.connexion.handle ?? '' : ''}</span>
          <a href={cree.lienMeet} target="_blank" rel="noopener noreferrer" style={s.lien}>{cree.lienMeet}</a>
          {cree.lienAgenda && (
            <a href={cree.lienAgenda} target="_blank" rel="noopener noreferrer" style={s.lien}>Ouvrir dans Google Agenda</a>
          )}
          <span style={s.note}>Note « Meet · {titre} » posée sur la fiche{emails.length ? ` et les fiches des ${emails.length} invités connus` : ''}.</span>
          <div style={s.ligne}>
            <button type="button" style={s.secondaire} onClick={fermer}>Fermer</button>
          </div>
        </div>
      ) : (
        <div style={s.bloc}>
          <label style={s.label}>
            Titre
            <input aria-label="Titre du Meet" style={s.champ} value={titre} onInput={surSaisie(setTitre)} onChange={surSaisie(setTitre)} />
          </label>
          <div style={s.ligne}>
            <label style={{ ...s.label, flex: '1 1 130px' }}>
              Date
              <input aria-label="Date" type="date" style={s.champ} value={date} onInput={surSaisie(setDate)} onChange={surSaisie(setDate)} />
            </label>
            <label style={{ ...s.label, flex: '1 1 90px' }}>
              Heure
              <input aria-label="Heure" type="time" style={s.champ} value={heure} onInput={surSaisie(setHeure)} onChange={surSaisie(setHeure)} />
            </label>
            <label style={{ ...s.label, flex: '1 1 90px' }}>
              Durée
              <select aria-label="Durée" style={s.champ} value={duree} onChange={surSaisie(setDuree)}>
                {DUREES.map((d) => (
                  <option key={d} value={String(d)}>{d} min</option>
                ))}
              </select>
            </label>
          </div>
          <div style={s.label}>
            Invités de la fiche
            {contexte.invites.length === 0 && <span style={s.note}>Aucune adresse sur la fiche.</span>}
            {contexte.invites.map((i) => (
              <button
                key={i.email}
                type="button"
                role="checkbox"
                aria-checked={coches.has(i.email)}
                style={{ ...s.case, background: 'transparent', border: 'none', padding: 0, color: 'inherit', textAlign: 'left' }}
                onClick={() => basculer(i.email)}
              >
                <span aria-hidden>{coches.has(i.email) ? '☑' : '☐'}</span>
                <span>{i.libelle}{i.libelle !== i.email ? ` · ${i.email}` : ''}</span>
              </button>
            ))}
          </div>
          <label style={s.label}>
            Autres invités (adresses séparées par des virgules)
            <input aria-label="Autres invités" style={s.champ} value={autres} onInput={surSaisie(setAutres)} onChange={surSaisie(setAutres)} />
          </label>
          <button
            type="button"
            role="checkbox"
            aria-checked={envoyer}
            style={{ ...s.case, background: 'transparent', border: 'none', padding: 0, color: 'inherit' }}
            onClick={() => setEnvoyer((v) => !v)}
          >
            <span aria-hidden>{envoyer ? '☑' : '☐'}</span>
            <span>Envoyer l’invitation Google aux invités</span>
          </button>
          {erreurs.map((e) => (
            <span key={e} style={s.erreur}>{e}</span>
          ))}
          <div style={s.ligne}>
            <button type="button" style={{ ...s.bouton, ...(peutCreer ? {} : s.boutonOff) }} disabled={!peutCreer} onClick={creer}>
              {envoi ? 'Création…' : `Créer le Meet${emails.length ? ` (${emails.length} invité${emails.length > 1 ? 's' : ''})` : ''}`}
            </button>
            <button type="button" style={s.secondaire} onClick={fermer}>Annuler</button>
          </div>
        </div>
      )}

      <div style={s.bloc}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600 }}>Meet de cette fiche ({reunions.length})</span>
          <button
            type="button"
            style={{ ...s.secondaire, ...(importEnCours || connexion.etat !== 'OK' ? s.boutonOff : {}) }}
            disabled={importEnCours || connexion.etat !== 'OK'}
            onClick={() => importer(reunions, connexion)}
          >
            {importEnCours ? 'Import…' : 'Importer les comptes rendus'}
          </button>
        </div>
        {bilan && <span style={s.note}>{bilan}</span>}
        {reunions.length === 0 && <span style={s.note}>Aucun Meet créé depuis le CRM pour cette fiche.</span>}
        {reunions.map((r) => (
          <div key={r.id} style={{ display: 'flex', flexDirection: 'column', gap: 2, borderTop: `1px solid ${theme.border.color.light}`, paddingTop: 6 }}>
            <span>{formatDateHeure(r.debut)} · {r.titre}</span>
            <span style={s.note}>
              {LIBELLE_STATUT[r.statut]}
              {r.lienMeet?.primaryLinkUrl ? ' · ' : ''}
              {r.lienMeet?.primaryLinkUrl && (
                <a href={r.lienMeet.primaryLinkUrl} target="_blank" rel="noopener noreferrer" style={s.lien}>lien</a>
              )}
              {r.lienEnregistrement?.primaryLinkUrl ? ' · ' : ''}
              {r.lienEnregistrement?.primaryLinkUrl && (
                <a href={r.lienEnregistrement.primaryLinkUrl} target="_blank" rel="noopener noreferrer" style={s.lien}>enregistrement</a>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default defineFrontComponent({
  universalIdentifier: PANNEAU_MEET_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  name: 'panneau-google-meet',
  description: 'Crée un Google Meet depuis une personne, une société ou un dossier et importe les comptes rendus de la fiche',
  component: PanneauMeet,
});
