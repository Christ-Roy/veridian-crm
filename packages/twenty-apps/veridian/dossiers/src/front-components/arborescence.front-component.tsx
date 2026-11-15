import { type CSSProperties, type ReactElement, useCallback, useEffect, useMemo, useState } from 'react';
import { CoreApiClient } from 'twenty-client-sdk/core';
import { MetadataApiClient } from 'twenty-client-sdk/metadata';
import { defineFrontComponent } from 'twenty-sdk/define';
import { AppPath, enqueueSnackbar, navigate, openSidePanelPage, SidePanelPages } from 'twenty-sdk/front-component';
import { IconChevronDown, IconChevronRight, IconFolder, IconFolderOpen, IconPlus, IconSearch } from 'twenty-ui/icon';
import { useTheme } from 'twenty-ui/theme';

import { ARBORESCENCE_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER } from '../identifiants';
import {
  avancementDossier,
  avancementSuivant,
  avancementTache,
  compter,
  construireArbre,
  type DossierBrut,
  grouperParCategorie,
  type Noeud,
  type Section,
  type Tache,
  toutesLesTaches,
} from '../utils/construire-arbre.util';
import { type Categorie, categorieDe, categorieSuivante, LIBELLES_CATEGORIE } from '../utils/categorie.util';
import { bilanDevis, type DevisBrut, euros, signalArgent } from '../utils/devis.util';
import { type Importance, importanceSuivante, LIBELLES_IMPORTANCE } from '../utils/importance.util';
import { LIBELLES_NATURE, type Nature, natureSuivante } from '../utils/nature.util';
import { creeBoucle, JOUR, type Lien, ordonnancer, type Placement } from '../utils/planning.util';

const STATUTS: Record<string, { libelle: string; suivant: string }> = {
  TODO: { libelle: 'À faire', suivant: 'IN_PROGRESS' },
  IN_PROGRESS: { libelle: 'En cours', suivant: 'DONE' },
  DONE: { libelle: 'Fait', suivant: 'TODO' },
};

const LIBELLES_STATUT_DEVIS: Record<string, string> = {
  BROUILLON: 'Brouillon',
  ENVOYE: 'Envoyé',
  SIGNE: 'Signé',
  REFUSE: 'Refusé',
  REMPLACE: 'Remplacé',
};
const LIBELLES_ENCAISSEMENT: Record<string, string> = {
  AUCUN: 'Rien reçu',
  PARTIEL: 'Partiel',
  TOTAL: 'Total',
  NON_VERIFIE: 'Non vérifié',
};

type LienBrut = Lien & { id: string };
type Mode = 'arbre' | 'gantt';

const messageErreur = (e: unknown) => (e instanceof Error ? e.message : String(e));
const signaler = (message: string) => void enqueueSnackbar({ message, variant: 'error' } as any);
const informer = (message: string) => void enqueueSnackbar({ message, variant: 'success' } as any);

const toutLire = async <T,>(objet: string, champs: Record<string, unknown>, filtre?: Record<string, unknown>): Promise<T[]> => {
  const client = new CoreApiClient();
  const lignes: T[] = [];
  let apres: string | undefined;
  for (let page = 0; page < 50; page++) {
    const reponse = await client.query({
      [objet]: {
        __args: { first: 100, ...(apres ? { after: apres } : {}), ...(filtre ? { filter: filtre } : {}) },
        edges: { node: champs },
        pageInfo: { hasNextPage: true, endCursor: true },
      },
    } as any);
    const connexion = (reponse as any)[objet];
    for (const edge of connexion?.edges ?? []) lignes.push(edge.node as T);
    if (!connexion?.pageInfo?.hasNextPage) break;
    apres = connexion.pageInfo.endCursor;
  }
  return lignes;
};

type SocieteEncaisse = { societe: { id: string; totalEncaisseProuve: { amountMicros: number | string | null } | null } | null };
const lireEncaisseSocietes = async (): Promise<SocieteEncaisse[]> => {
  const reponse = await (new CoreApiClient() as any).executeGraphqlRequestWithOptionalRefresh({
    operation: { query: '{ dossiers(first: 200) { edges { node { societe { id totalEncaisseProuve { amountMicros } } } } } }', variables: {} },
  });
  const data = reponse?.data ?? reponse;
  if (reponse?.errors?.length) throw new Error(reponse.errors[0].message);
  return (data?.dossiers?.edges ?? []).map((e: any) => e.node as SocieteEncaisse);
};

const ouvrir = (objectNameSingular: 'task' | 'dossier' | 'devis', id: string) =>
  openSidePanelPage({ page: SidePanelPages.ViewRecord, recordId: id, objectNameSingular } as any);

// Listes de prospects rangées dans la catégorie Prospection (ex-dossiers de la barre latérale) : vues de
// sociétés dont le nom commence par l'un de ces préfixes, retrouvées par leur nom (aucun identifiant en dur).
const LISTES_PROSPECTION = ['Vente en ligne', 'Site vitrine'];
type VueListe = { id: string; liste: string; variante: string };

const chargerListesProspection = async (): Promise<VueListe[]> => {
  const client = new MetadataApiClient();
  const { objects } = await client.query({
    objects: { __args: { filter: {}, paging: { first: 200 } }, edges: { node: { id: true, nameSingular: true } } },
  });
  const societe = (objects?.edges ?? []).find((e: any) => e.node.nameSingular === 'company')?.node;
  if (!societe) return [];
  const reponse = await client.query({ getViews: { __args: { objectMetadataId: societe.id }, id: true, name: true } } as any);
  const vues = ((reponse as any)?.getViews ?? []) as { id: string; name: string }[];
  return vues
    .map((v) => {
      const liste = LISTES_PROSPECTION.find((p) => v.name.startsWith(p));
      return liste ? { id: v.id, liste, variante: v.name.slice(liste.length).replace(/^[\s·-]+/, '') || 'Vue' } : null;
    })
    .filter((v): v is VueListe => v !== null)
    .sort((a, b) => LISTES_PROSPECTION.indexOf(a.liste) - LISTES_PROSPECTION.indexOf(b.liste) || a.variante.localeCompare(b.variante, 'fr'));
};

const ouvrirVueSocietes = (viewId: string) =>
  navigate(AppPath.RecordIndexPage, { objectNamePlural: 'companies' }, { viewId });

const ouvrirSociete = (id: string) =>
  navigate(AppPath.RecordShowPage, { objectNameSingular: 'company', objectRecordId: id });

const jourCourt = (ms: number) => new Date(ms).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });

const Projets = () => {
  const t = useTheme();
  const [taches, setTaches] = useState<Tache[] | null>(null);
  const [dossiers, setDossiers] = useState<DossierBrut[]>([]);
  const [devis, setDevis] = useState<DevisBrut[]>([]);
  const [liens, setLiens] = useState<LienBrut[]>([]);
  const [encaisseSociete, setEncaisseSociete] = useState<Map<string, number>>(new Map());
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  const [voirFaites, setVoirFaites] = useState(false);
  const [recherche, setRecherche] = useState('');
  const [ouverts, setOuverts] = useState<Set<string> | null>(null);
  const [listes, setListes] = useState<VueListe[]>([]);
  const [mode, setMode] = useState<Mode>('arbre');
  const [depOuverte, setDepOuverte] = useState<string | null>(null);
  const [rechercheDep, setRechercheDep] = useState('');

  // Les listes de prospection sont un plus : leur échec ne bloque pas la page.
  useEffect(() => {
    chargerListesProspection()
      .then(setListes)
      .catch(() => setListes([]));
  }, []);

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      const [ds, ts, dv, ls] = await Promise.all([
        toutLire<DossierBrut>('dossiers', { id: true, nom: true, importance: true, categorie: true, parentId: true, societeId: true }),
        toutLire<Tache>('tasks', {
          id: true,
          title: true,
          status: true,
          dueAt: true,
          importance: true,
          suiviAvancement: true,
          rangementId: true,
          nature: true,
          suiviType: true,
          besoinAgenda: true,
          dureeEstimee: true,
        }),
        toutLire<DevisBrut>('devisListe', {
          id: true,
          numero: true,
          dateDevis: true,
          objet: true,
          montant: true,
          statut: true,
          encaissement: true,
          montantEncaisse: true,
          preuve: true,
          dossierId: true,
        }),
        toutLire<LienBrut>('dependances', { id: true, tacheId: true, prerequisId: true }),
      ]);
      // L'encaissé prouvé de la fiche société (relevé bancaire) couvre les factures sans devis.
      // Lu par la relation du dossier (une requête) ; un échec ne bloque pas la page mais se dit.
      // Requête brute : le client typé de l'app refuse les champs de Company créés hors de l'app
      // (« type Company does not have a field totalEncaisseProuve »), le serveur, lui, les sert.
      const societes = await lireEncaisseSocietes().catch((e) => {
        signaler(`Encaissé des fiches sociétés illisible : ${messageErreur(e)}`);
        return [];
      });
      setEncaisseSociete(
        new Map(
          societes
            .filter((x) => x.societe)
            .map((x) => [x.societe!.id, Number(x.societe!.totalEncaisseProuve?.amountMicros ?? 0) / 1e6]),
        ),
      );
      setDossiers(ds);
      setTaches(ts);
      setDevis(dv);
      setLiens(ls);
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  const arbre = useMemo(() => construireArbre(dossiers, taches ?? []), [dossiers, taches]);
  const { sections, sansDossier } = useMemo(() => grouperParCategorie(arbre), [arbre]);
  const idSection = (c: Categorie) => `categorie:${c}`;

  const parId = useMemo(() => new Map((taches ?? []).map((x) => [x.id, x])), [taches]);
  const placements = useMemo(
    () =>
      ordonnancer(
        (taches ?? []).map((x) => ({ id: x.id, dueAt: x.dueAt, status: x.status, suiviType: x.suiviType ?? null, dureeEstimee: x.dureeEstimee })),
        liens,
        Date.now(),
      ),
    [taches, liens],
  );
  const attend = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const l of liens) if (l.tacheId && l.prerequisId) m.set(l.tacheId, [...(m.get(l.tacheId) ?? []), l.prerequisId]);
    return m;
  }, [liens]);
  const bloque = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const l of liens) if (l.tacheId && l.prerequisId) m.set(l.prerequisId, [...(m.get(l.prerequisId) ?? []), l.tacheId]);
    return m;
  }, [liens]);
  const devisParDossier = useMemo(() => {
    const m = new Map<string, DevisBrut[]>();
    for (const d of devis) if (d.dossierId) m.set(d.dossierId, [...(m.get(d.dossierId) ?? []), d]);
    for (const l of m.values()) l.sort((a, b) => (a.numero ?? '').localeCompare(b.numero ?? ''));
    return m;
  }, [devis]);
  const devisDe = (n: Noeud): DevisBrut[] => [...(devisParDossier.get(n.id) ?? []), ...n.enfants.flatMap(devisDe)];
  const argentDe = (n: Noeud, racine: boolean) => {
    const bilan = bilanDevis(devisDe(n));
    const societe = n.societeId ? encaisseSociete.get(n.societeId) ?? 0 : 0;
    return { bilan, societe, signal: racine && !n.virtuel ? signalArgent(categorieDe(n.categorie), bilan.encaisse, societe) : null };
  };

  const ouvertes = (taches ?? []).filter((x) => x.status !== 'DONE');
  const jalonsSansDate = ouvertes.filter((x) => placements.get(x.id)?.jalonSansDate);
  const enBoucle = ouvertes.filter((x) => placements.get(x.id)?.dansBoucle);
  const signauxArgent = arbre.filter((n) => !n.virtuel && argentDe(n, true).signal).length;

  // Par défaut : catégories ouvertes ; un dossier racine n'est ouvert que s'il a des tâches ouvertes
  // (les dossiers clients livrés restent fermés) ; sous-dossiers fermés.
  const racines = useMemo(
    () =>
      new Set([
        ...sections.map((x) => idSection(x.categorie)),
        ...arbre.filter((n) => compter(toutesLesTaches(n)).ouvertes > 0).map((n) => n.id),
      ]),
    [sections, arbre],
  );
  const estOuvert = (id: string) => (ouverts ? ouverts.has(id) : racines.has(id));
  const basculer = (id: string) => {
    const suivant = new Set(ouverts ?? racines);
    if (suivant.has(id)) suivant.delete(id);
    else suivant.add(id);
    setOuverts(suivant);
  };
  const tousLesIds = (ns: Noeud[]): string[] => ns.flatMap((n) => [n.id, ...tousLesIds(n.enfants)]);
  const ouvrirAussi = (id: string) => setOuverts(new Set([...(ouverts ?? racines), id]));

  const filtre = recherche.trim().toLowerCase();
  const tacheVisible = (x: Tache) =>
    (voirFaites || x.status !== 'DONE') && (!filtre || (x.title ?? '').toLowerCase().includes(filtre));
  const contientVisible = (n: Noeud): boolean => n.taches.some(tacheVisible) || n.enfants.some(contientVisible);

  // Écritures : mise à jour optimiste, retour arrière et message si l'API refuse.
  const majTache = async (tache: Tache, data: Partial<Tache>) => {
    setTaches((prec) => (prec ?? []).map((x) => (x.id === tache.id ? { ...x, ...data } : x)));
    try {
      await new CoreApiClient().mutation({ updateTask: { __args: { id: tache.id, data: data as any }, id: true } } as any);
    } catch (e) {
      setTaches((prec) => (prec ?? []).map((x) => (x.id === tache.id ? tache : x)));
      signaler(`Tâche non enregistrée : ${messageErreur(e)}`);
    }
  };
  const majDossier = async (n: Noeud, data: Partial<DossierBrut>) => {
    const avant = dossiers.find((d) => d.id === n.id);
    setDossiers((prec) => prec.map((d) => (d.id === n.id ? { ...d, ...data } : d)));
    try {
      await new CoreApiClient().mutation({ updateDossier: { __args: { id: n.id, data: data as any }, id: true } } as any);
    } catch (e) {
      if (avant) setDossiers((prec) => prec.map((d) => (d.id === n.id ? avant : d)));
      signaler(`Dossier non enregistré : ${messageErreur(e)}`);
    }
  };
  const creerTache = async (n: Noeud) => {
    try {
      const data: Record<string, unknown> = { title: 'Nouvelle tâche', status: 'TODO' };
      if (!n.virtuel) data.rangementId = n.id;
      const { createTask } = (await new CoreApiClient().mutation({ createTask: { __args: { data: data as any }, id: true } } as any)) as any;
      ouvrirAussi(n.id);
      await charger();
      if (createTask?.id) await ouvrir('task', createTask.id);
    } catch (e) {
      signaler(`Tâche non créée : ${messageErreur(e)}`);
    }
  };
  const creerDossier = async (parent: Noeud | null, categorie?: Categorie) => {
    try {
      const data: Record<string, unknown> = { nom: parent ? 'Nouveau sous-dossier' : 'Nouveau dossier' };
      if (parent) data.parentId = parent.id;
      // Un sous-dossier reprend la catégorie de son parent (seule celle de la racine compte à l'affichage).
      data.categorie = categorieDe(parent ? parent.categorie : categorie);
      const reponse = await new CoreApiClient().mutation({ createDossier: { __args: { data }, id: true } } as any);
      if (parent) ouvrirAussi(parent.id);
      else if (categorie) ouvrirAussi(idSection(categorie));
      await charger();
      const id = (reponse as any)?.createDossier?.id;
      if (id) await ouvrir('dossier', id);
    } catch (e) {
      signaler(`Dossier non créé : ${messageErreur(e)}`);
    }
  };
  // Ajouter un prérequis : refusé s'il fermerait une boucle (le prérequis attend déjà, même de loin, cette tâche).
  const ajouterPrerequis = async (tache: Tache, prerequis: Tache) => {
    if (creeBoucle(liens, tache.id, prerequis.id)) {
      signaler(`Refusé : « ${prerequis.title} » attend déjà « ${tache.title} », ce serait une boucle.`);
      return;
    }
    try {
      const libelle = `${tache.title ?? 'Tâche'} attend ${prerequis.title ?? 'tâche'}`.slice(0, 250);
      const reponse = await new CoreApiClient().mutation({
        createDependance: { __args: { data: { tacheId: tache.id, prerequisId: prerequis.id, libelle } }, id: true },
      } as any);
      const id = (reponse as any)?.createDependance?.id;
      if (id) setLiens((prec) => [...prec, { id, tacheId: tache.id, prerequisId: prerequis.id }]);
      setRechercheDep('');
      informer(`Prérequis ajouté : « ${prerequis.title} »`);
    } catch (e) {
      signaler(`Prérequis non enregistré : ${messageErreur(e)}`);
    }
  };

  const couleurImportance = (v: string | null) =>
    v === 'CRITIQUE' ? t.color.red : v === 'HAUTE' ? t.color.orange : v === 'BASSE' ? t.font.color.tertiary : t.color.blue;

  const s: Record<string, CSSProperties> = {
    racine: {
      boxSizing: 'border-box',
      display: 'grid',
      gridTemplateRows: 'auto minmax(0, 1fr)',
      height: '100%',
      minHeight: '100%',
      width: '100%',
      overflow: 'hidden',
      fontFamily: t.font.family,
      color: t.font.color.primary,
      background: t.background.primary,
    },
    entete: {
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: t.spacing[2],
      padding: `${t.spacing[3]} ${t.spacing[4]}`,
      borderBottom: `1px solid ${t.border.color.light}`,
    },
    titre: { fontSize: t.font.size.lg, fontWeight: t.font.weight.semiBold, marginRight: t.spacing[2] },
    compte: { color: t.font.color.tertiary, fontSize: t.font.size.sm, marginRight: 'auto' },
    recherche: {
      display: 'flex',
      alignItems: 'center',
      gap: t.spacing[1],
      border: `1px solid ${t.border.color.medium}`,
      borderRadius: t.border.radius.sm,
      padding: `0 ${t.spacing[2]}`,
      background: t.background.secondary,
      color: t.font.color.tertiary,
    },
    champ: {
      border: 'none',
      outline: 'none',
      background: 'transparent',
      color: t.font.color.primary,
      fontSize: t.font.size.md,
      padding: `${t.spacing[1]} 0`,
      width: '180px',
      fontFamily: t.font.family,
    },
    bouton: {
      border: `1px solid ${t.border.color.medium}`,
      borderRadius: t.border.radius.sm,
      background: t.background.secondary,
      color: t.font.color.secondary,
      fontSize: t.font.size.sm,
      padding: `${t.spacing[1]} ${t.spacing[2]}`,
      cursor: 'pointer',
      fontFamily: t.font.family,
    },
    corps: { overflow: 'auto', minHeight: 0, padding: `${t.spacing[2]} ${t.spacing[2]} ${t.spacing[8]}` },
    ligneDossier: {
      display: 'grid',
      gridTemplateColumns: 'minmax(0, 1fr) 76px 150px auto',
      alignItems: 'center',
      gap: t.spacing[3],
      padding: `${t.spacing[1]} ${t.spacing[3]} ${t.spacing[1]} 0`,
      cursor: 'pointer',
      borderRadius: t.border.radius.sm,
    },
    nomDossier: { display: 'flex', alignItems: 'center', gap: t.spacing[2], minWidth: 0 },
    ligneTache: {
      display: 'grid',
      gridTemplateColumns: '80px minmax(0, 1fr) 76px 150px 96px',
      alignItems: 'center',
      gap: t.spacing[3],
      padding: `${t.spacing[1]} ${t.spacing[3]} ${t.spacing[1]} 0`,
      fontSize: t.font.size.md,
      borderBottom: `1px solid ${t.border.color.light}`,
    },
    ligneDevis: {
      display: 'grid',
      gridTemplateColumns: '80px minmax(0, 1fr) 76px 150px 96px',
      alignItems: 'center',
      gap: t.spacing[3],
      padding: `2px ${t.spacing[3]} 2px 0`,
      fontSize: t.font.size.sm,
      color: t.font.color.secondary,
      cursor: 'pointer',
    },
    badge: { color: t.font.color.tertiary, fontSize: t.font.size.sm, fontWeight: t.font.weight.regular, whiteSpace: 'nowrap' },
    aucune: { color: t.font.color.tertiary, fontSize: t.font.size.sm, padding: `${t.spacing[1]} 0 ${t.spacing[2]}` },
    tronque: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
    actions: { display: 'flex', gap: t.spacing[1], justifyContent: 'flex-end' },
    lien: {
      border: 'none',
      background: 'transparent',
      color: t.font.color.tertiary,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: '2px',
      fontSize: t.font.size.sm,
      fontFamily: t.font.family,
      whiteSpace: 'nowrap',
    },
    panneau: {
      display: 'grid',
      gap: t.spacing[1],
      margin: `0 ${t.spacing[3]} ${t.spacing[2]} 0`,
      padding: t.spacing[2],
      border: `1px solid ${t.border.color.medium}`,
      borderRadius: t.border.radius.sm,
      background: t.background.secondary,
      fontSize: t.font.size.sm,
    },
    vide: { padding: t.spacing[8], textAlign: 'center', color: t.font.color.tertiary },
    erreur: { padding: t.spacing[6], color: t.font.color.danger, display: 'grid', gap: t.spacing[3], justifyItems: 'start' },
  };

  const pastille = (couleur: string): CSSProperties => ({
    border: `1px solid ${t.border.color.medium}`,
    borderRadius: t.border.radius.pill,
    fontSize: t.font.size.xs,
    padding: `2px ${t.spacing[2]}`,
    cursor: 'pointer',
    textAlign: 'center',
    background: 'transparent',
    fontFamily: t.font.family,
    color: couleur,
    whiteSpace: 'nowrap',
  });
  const alerte = (couleur: string): CSSProperties => ({ ...pastille(couleur), cursor: 'default', borderColor: couleur });

  const Importance = ({ valeur, onClic }: { valeur: string | null; onClic?: () => void }) =>
    onClic ? (
      <button
        style={pastille(couleurImportance(valeur))}
        title="Importance : cliquer pour monter d'un cran"
        onClick={(e) => {
          e.stopPropagation();
          onClic();
        }}
      >
        {LIBELLES_IMPORTANCE[(valeur ?? 'NORMALE') as Importance] ?? valeur}
      </button>
    ) : (
      <span />
    );

  const Barre = ({ pourcent, onClic, titre }: { pourcent: number | null; onClic?: () => void; titre: string }) => (
    <div
      title={titre}
      onClick={
        onClic
          ? (e) => {
              e.stopPropagation();
              onClic();
            }
          : undefined
      }
      style={{ display: 'flex', alignItems: 'center', gap: t.spacing[2], cursor: onClic ? 'pointer' : 'default' }}
    >
      <div style={{ flex: 1, height: '6px', borderRadius: t.border.radius.pill, background: t.background.tertiary, overflow: 'hidden' }}>
        <div style={{ width: `${pourcent ?? 0}%`, height: '100%', background: pourcent === 100 ? t.color.green : t.color.blue }} />
      </div>
      <span style={{ ...s.badge, width: '34px', textAlign: 'right' }}>{pourcent === null ? '—' : `${pourcent} %`}</span>
    </div>
  );

  const echeance = (tache: Tache) => {
    if (!tache.dueAt) return <span />;
    const date = new Date(tache.dueAt);
    const enRetard = tache.status !== 'DONE' && date.getTime() < Date.now();
    return (
      <span style={{ fontSize: t.font.size.sm, color: enRetard ? t.font.color.danger : t.font.color.tertiary, textAlign: 'right' }}>
        {date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
      </span>
    );
  };

  // Les dossiers racines sont déjà dans une section de catégorie : un cran de retrait de plus.
  const retrait = (niveau: number) => `calc(${t.spacing[2]} + ${(niveau + 1) * 24}px)`;

  const couleurCategorie = (c: Categorie) => (c === 'CLIENT' ? t.color.green : c === 'PROSPECTION' ? t.color.orange : t.color.purple);
  const couleurEncaissement = (v: string | null) =>
    v === 'TOTAL' ? t.color.green : v === 'PARTIEL' ? t.color.orange : v === 'AUCUN' ? t.color.red : t.font.color.tertiary;

  const titreDe = (id: string) => parId.get(id)?.title || 'Tâche supprimée';

  const panneauDependances = (tache: Tache, niveau: number) => {
    const avant = attend.get(tache.id) ?? [];
    const apres = bloque.get(tache.id) ?? [];
    const q = rechercheDep.trim().toLowerCase();
    const candidats =
      q.length < 2
        ? []
        : (taches ?? [])
            .filter((x) => x.id !== tache.id && !avant.includes(x.id) && (x.title ?? '').toLowerCase().includes(q))
            .sort((a, b) => (a.status === 'DONE' ? 1 : 0) - (b.status === 'DONE' ? 1 : 0))
            .slice(0, 8);
    const listeLiens = (ids: string[]) =>
      ids.length === 0 ? (
        <span style={{ color: t.font.color.tertiary }}>rien</span>
      ) : (
        ids.map((id) => (
          <button key={id} style={{ ...s.lien, color: t.font.color.secondary }} onClick={() => void ouvrir('task', id)}>
            {parId.get(id)?.status === 'DONE' ? '✓ ' : ''}
            {titreDe(id)}
          </button>
        ))
      );
    return (
      <div style={{ ...s.panneau, marginLeft: `calc(${retrait(niveau)} + 92px)` }}>
        {placements.get(tache.id)?.dansBoucle && (
          <span style={{ color: t.font.color.danger }}>Boucle : cette tâche s'attend elle-même à travers ses prérequis. Retirer un lien dans la fiche.</span>
        )}
        {placements.get(tache.id)?.conflit && (
          <span style={{ color: t.color.orange }}>Un prérequis finit le jour de l'échéance ou après : échéance intenable.</span>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: t.spacing[2], alignItems: 'center' }}>
          <strong>Attend :</strong> {listeLiens(avant)}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: t.spacing[2], alignItems: 'center' }}>
          <strong>Bloque :</strong> {listeLiens(apres)}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: t.spacing[2], alignItems: 'center' }}>
          <strong>+ Prérequis :</strong>
          <label style={s.recherche}>
            <IconSearch size={12} />
            <input
              style={{ ...s.champ, width: '220px', fontSize: t.font.size.sm }}
              placeholder="Chercher la tâche attendue"
              aria-label="Chercher la tâche attendue"
              value={rechercheDep}
              onChange={(e) => setRechercheDep(e.target.value)}
            />
          </label>
          {candidats.map((c) => (
            <button key={c.id} style={pastille(t.font.color.secondary)} onClick={() => void ajouterPrerequis(tache, c)} title="Ajouter comme prérequis">
              {(c.title ?? '').slice(0, 60)}
            </button>
          ))}
          <button style={s.lien} onClick={() => void ouvrir('task', tache.id)} title="Retirer un lien : dans la fiche, champ « Attend »">
            Fiche
          </button>
        </div>
      </div>
    );
  };

  const rendreTache = (tache: Tache, niveau: number) => {
    const nbAvant = (attend.get(tache.id) ?? []).length;
    const nbApres = (bloque.get(tache.id) ?? []).length;
    const pl = placements.get(tache.id);
    const nature = (tache.nature ?? 'HUMAIN') as Nature;
    return (
      <div key={tache.id}>
        <div style={{ ...s.ligneTache, paddingLeft: retrait(niveau) }}>
          <button
            style={pastille(tache.status === 'DONE' ? t.font.color.tertiary : tache.status === 'IN_PROGRESS' ? t.color.orange : t.color.blue)}
            onClick={() => void majTache(tache, { status: STATUTS[tache.status ?? 'TODO']?.suivant ?? 'TODO' })}
            title="Statut : cliquer pour avancer"
          >
            {STATUTS[tache.status ?? 'TODO']?.libelle ?? tache.status}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: t.spacing[2], minWidth: 0 }}>
            {tache.suiviType === 'JALON' && <span title="Jalon" style={{ color: t.color.orange }}>◆</span>}
            <span
              style={{
                ...s.tronque,
                cursor: 'pointer',
                color: tache.status === 'DONE' ? t.font.color.tertiary : t.font.color.primary,
                textDecoration: tache.status === 'DONE' ? 'line-through' : 'none',
              }}
              onClick={() => void ouvrir('task', tache.id)}
              title={tache.title ?? ''}
            >
              {tache.title || 'Sans titre'}
            </span>
            <button
              style={pastille(nature === 'HUMAIN' ? t.color.turquoise : t.color.purple)}
              title="Nature : Robert (temps humain) ou Production (agents et IA). Cliquer pour basculer"
              onClick={() => void majTache(tache, { nature: natureSuivante(tache.nature) })}
            >
              {LIBELLES_NATURE[nature] ?? nature}
            </button>
            <button
              style={pastille(pl?.dansBoucle ? t.color.red : nbAvant + nbApres > 0 ? t.font.color.secondary : t.font.color.tertiary)}
              title="Dépendances : ce que la tâche attend, ce qu'elle bloque ; ajouter un prérequis"
              aria-label={`Dépendances de ${tache.title}`}
              onClick={() => {
                setRechercheDep('');
                setDepOuverte(depOuverte === tache.id ? null : tache.id);
              }}
            >
              {pl?.dansBoucle ? 'Boucle' : `⇠ ${nbAvant} · ${nbApres} ⇢`}
            </button>
            {pl?.jalonSansDate && <span style={alerte(t.color.red)}>Jalon sans date</span>}
          </div>
          <Importance valeur={tache.importance} onClic={() => void majTache(tache, { importance: importanceSuivante(tache.importance) })} />
          <Barre
            pourcent={avancementTache(tache)}
            titre={tache.status === 'DONE' ? 'Faite : 100 %' : 'Avancement : cliquer pour +25 %'}
            onClic={tache.status === 'DONE' ? undefined : () => void majTache(tache, { suiviAvancement: avancementSuivant(tache.suiviAvancement) })}
          />
          {echeance(tache)}
        </div>
        {depOuverte === tache.id && panneauDependances(tache, niveau)}
      </div>
    );
  };

  const rendreDevis = (d: DevisBrut, niveau: number) => (
    <div key={d.id} style={{ ...s.ligneDevis, paddingLeft: retrait(niveau) }} onClick={() => void ouvrir('devis', d.id)} title={d.preuve ?? ''}>
      <span style={{ ...pastille(t.font.color.secondary), cursor: 'pointer' }}>{d.numero}</span>
      <span style={s.tronque}>
        Devis · {LIBELLES_STATUT_DEVIS[d.statut ?? ''] ?? d.statut} · {d.objet}
      </span>
      <span style={{ textAlign: 'right' }}>{euros(d.montant)}</span>
      <span style={{ color: couleurEncaissement(d.encaissement), textAlign: 'right' }}>
        {LIBELLES_ENCAISSEMENT[d.encaissement ?? ''] ?? d.encaissement}
        {d.encaissement === 'PARTIEL' || d.encaissement === 'TOTAL' ? ` · ${euros(d.montantEncaisse)}` : ''}
      </span>
      <span />
    </div>
  );

  const pastillesArgent = (n: Noeud, racine: boolean) => {
    if (n.virtuel) return null;
    const { bilan, societe, signal } = argentDe(n, racine);
    if (bilan.nombre === 0 && societe === 0 && !signal) return null;
    const recu = Math.max(bilan.encaisse, societe);
    return (
      <>
        {(bilan.nombre > 0 || societe > 0) && (
          <span
            style={s.badge}
            title={`Encaissé prouvé : ${euros(bilan.encaisse)} sur les devis, ${euros(societe)} sur la fiche société (relevé bancaire)`}
          >
            {bilan.nombre > 0 ? `${bilan.nombre} devis · ${bilan.promis > 0 ? `${euros(bilan.promis)} · ` : ''}` : ''}encaissé {euros(recu)}
          </span>
        )}
        {signal === 'CLIENT_SANS_ENCAISSEMENT' && (
          <span style={alerte(t.color.red)} title="Règle de Robert : sans argent reçu, c'est encore de la prospection">
            Client sans encaissement prouvé
          </span>
        )}
        {signal === 'PROSPECTION_ENCAISSEE' && (
          <span style={alerte(t.color.orange)} title="De l'argent est reçu et prouvé : le dossier devrait passer en Client">
            Prospection avec encaissé
          </span>
        )}
      </>
    );
  };

  const rendreDossier = (n: Noeud, niveau: number): ReactElement | null => {
    if (filtre && !contientVisible(n)) return null;
    const ouvert = filtre ? true : estOuvert(n.id);
    const c = compter(toutesLesTaches(n));
    const tachesVisibles = n.taches.filter(tacheVisible);
    const devisIci = filtre ? [] : devisParDossier.get(n.id) ?? [];
    return (
      <div key={n.id} style={{ marginBottom: niveau === 0 ? t.spacing[1] : 0 }}>
        <div style={{ ...s.ligneDossier, paddingLeft: retrait(niveau) }} onClick={() => basculer(n.id)}>
          <div style={{ ...s.nomDossier, fontSize: t.font.size.md, fontWeight: niveau === 0 ? t.font.weight.semiBold : t.font.weight.medium }}>
            {ouvert ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
            {ouvert ? <IconFolderOpen size={niveau === 0 ? 18 : 16} /> : <IconFolder size={niveau === 0 ? 18 : 16} />}
            <span style={s.tronque}>{n.nom}</span>
            <span style={s.badge}>
              {c.ouvertes} / {c.total}
            </span>
            {niveau === 0 && !n.virtuel && (
              <button
                style={pastille(couleurCategorie(categorieDe(n.categorie)))}
                title="Catégorie : cliquer pour déplacer le dossier vers la catégorie suivante"
                onClick={(e) => {
                  e.stopPropagation();
                  void majDossier(n, { categorie: categorieSuivante(n.categorie) });
                }}
              >
                {LIBELLES_CATEGORIE[categorieDe(n.categorie)]}
              </button>
            )}
            {pastillesArgent(n, niveau === 0)}
          </div>
          {n.virtuel ? <span /> : <Importance valeur={n.importance} onClic={() => void majDossier(n, { importance: importanceSuivante(n.importance) })} />}
          <Barre pourcent={avancementDossier(n)} titre="Avancement du dossier : moyenne de ses tâches (faite = 100 %)" />
          <div style={s.actions}>
            <button
              style={s.lien}
              aria-label={`Nouvelle tâche dans ${n.nom}`}
              onClick={(e) => {
                e.stopPropagation();
                void creerTache(n);
              }}
            >
              <IconPlus size={12} /> Tâche
            </button>
            {!n.virtuel && (
              <>
                <button
                  style={s.lien}
                  aria-label={`Nouveau sous-dossier dans ${n.nom}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void creerDossier(n);
                  }}
                >
                  <IconPlus size={12} /> Sous-dossier
                </button>
                {n.societeId && (
                  <button
                    style={s.lien}
                    aria-label={`Ouvrir la fiche société de ${n.nom}`}
                    title="Fiche société : historique, notes, mails, encaissements"
                    onClick={(e) => {
                      e.stopPropagation();
                      void ouvrirSociete(n.societeId!);
                    }}
                  >
                    Fiche
                  </button>
                )}
                <button
                  style={s.lien}
                  aria-label={`Modifier le dossier ${n.nom}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void ouvrir('dossier', n.id);
                  }}
                >
                  Modifier
                </button>
              </>
            )}
          </div>
        </div>
        {ouvert && (
          <div>
            {devisIci.map((d) => rendreDevis(d, niveau + 1))}
            {n.enfants.map((e) => rendreDossier(e, niveau + 1))}
            {tachesVisibles.map((x) => rendreTache(x, niveau + 1))}
            {n.enfants.length === 0 && tachesVisibles.length === 0 && devisIci.length === 0 && (
              <div style={{ ...s.aucune, paddingLeft: retrait(niveau + 1) }}>{voirFaites ? 'Aucune tâche' : 'Aucune tâche ouverte'}</div>
            )}
          </div>
        )}
      </div>
    );
  };

  const rendreSection = (section: Section): ReactElement | null => {
    const id = idSection(section.categorie);
    if (filtre && !section.racines.some(contientVisible)) return null;
    const ouvert = filtre ? true : estOuvert(id);
    // Avancement de la catégorie : même règle qu'un dossier, sur toutes les tâches de ses dossiers.
    const groupe: Noeud = { id, nom: '', importance: null, categorie: null, virtuel: true, enfants: section.racines, taches: [] };
    const c = compter(toutesLesTaches(groupe));
    return (
      <section key={id} style={{ marginBottom: t.spacing[3] }}>
        <div
          style={{ ...s.ligneDossier, padding: `${t.spacing[2]} ${t.spacing[3]} ${t.spacing[2]} ${t.spacing[2]}`, borderBottom: `1px solid ${t.border.color.medium}` }}
          onClick={() => basculer(id)}
        >
          <div style={{ ...s.nomDossier, fontSize: t.font.size.lg, fontWeight: t.font.weight.semiBold }}>
            {ouvert ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
            <span style={{ color: couleurCategorie(section.categorie) }}>{LIBELLES_CATEGORIE[section.categorie]}</span>
            <span style={s.badge}>
              {section.racines.length} dossier{section.racines.length > 1 ? 's' : ''} · {c.ouvertes} / {c.total}
            </span>
          </div>
          <span />
          <Barre pourcent={avancementDossier(groupe)} titre="Avancement de la catégorie : moyenne de toutes ses tâches (faite = 100 %)" />
          <div style={s.actions}>
            <button
              style={s.lien}
              aria-label={`Nouveau dossier ${LIBELLES_CATEGORIE[section.categorie]}`}
              onClick={(e) => {
                e.stopPropagation();
                void creerDossier(null, section.categorie);
              }}
            >
              <IconPlus size={12} /> Dossier
            </button>
          </div>
        </div>
        {ouvert && section.categorie === 'PROSPECTION' && listes.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: t.spacing[3],
              padding: `${t.spacing[2]} ${t.spacing[3]} ${t.spacing[2]} ${retrait(0)}`,
              fontSize: t.font.size.sm,
              color: t.font.color.tertiary,
            }}
          >
            <span>Listes de prospects :</span>
            {LISTES_PROSPECTION.filter((l) => listes.some((v) => v.liste === l)).map((l) => (
              <span key={l} style={{ display: 'flex', alignItems: 'center', gap: t.spacing[1] }}>
                <span style={{ color: t.font.color.secondary, fontWeight: t.font.weight.medium }}>{l}</span>
                {listes
                  .filter((v) => v.liste === l)
                  .map((v) => (
                    <button key={v.id} style={pastille(t.color.orange)} onClick={() => void ouvrirVueSocietes(v.id)} aria-label={`Ouvrir ${l} ${v.variante}`}>
                      {v.variante}
                    </button>
                  ))}
              </span>
            ))}
          </div>
        )}
        {ouvert &&
          (section.racines.length === 0 ? (
            <div style={{ ...s.aucune, paddingLeft: retrait(0) }}>Aucun dossier : « + Dossier » pour en créer un.</div>
          ) : (
            section.racines.map((n) => rendreDossier(n, 0))
          ))}
      </section>
    );
  };

  // Gantt : une ligne par tâche visible, groupées par dossier racine. Jalons en losanges à leur échéance, tâches
  // datées en barres pleines, tâches sans date en barres pointillées placées après leurs prérequis, retards en rouge.
  const rendreGantt = () => {
    const groupes: { id: string; nom: string; categorie: Categorie | null; taches: Tache[] }[] = [];
    for (const section of sections)
      for (const n of section.racines) {
        const ts = toutesLesTaches(n).filter(tacheVisible);
        if (ts.length) groupes.push({ id: n.id, nom: n.nom, categorie: section.categorie, taches: ts });
      }
    if (sansDossier) {
      const ts = sansDossier.taches.filter(tacheVisible);
      if (ts.length) groupes.push({ id: sansDossier.id, nom: sansDossier.nom, categorie: null, taches: ts });
    }
    const vues = groupes.flatMap((g) => g.taches.map((x) => placements.get(x.id)).filter((p): p is Placement => !!p));
    if (vues.length === 0) return <div style={s.vide}>Aucune tâche à placer.</div>;
    const aujourdhui = Math.floor(Date.now() / JOUR) * JOUR;
    const min = Math.min(aujourdhui, ...vues.map((p) => p.debut)) - JOUR;
    const max = Math.max(aujourdhui, ...vues.map((p) => p.fin)) + 2 * JOUR;
    const etendue = max - min;
    const pct = (ms: number) => `${((ms - min) / etendue) * 100}%`;
    const premierLundi = min + ((8 - new Date(min).getUTCDay()) % 7) * JOUR;
    const pas = etendue > 120 * JOUR ? 28 : etendue > 45 * JOUR ? 14 : 7;
    const reperes: number[] = [];
    for (let d = premierLundi; d < max; d += pas * JOUR) reperes.push(d);
    const grille: CSSProperties = { display: 'grid', gridTemplateColumns: '320px minmax(0, 1fr)', alignItems: 'center' };
    const fond = (
      <>
        {reperes.map((d) => (
          <div key={d} style={{ position: 'absolute', top: 0, bottom: 0, left: pct(d), borderLeft: `1px solid ${t.border.color.light}` }} />
        ))}
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: pct(aujourdhui), borderLeft: `2px solid ${t.color.blue}` }} />
      </>
    );
    const ligne = (x: Tache) => {
      const p = placements.get(x.id)!;
      const fait = x.status === 'DONE';
      const couleur = fait ? t.font.color.tertiary : p.enRetard ? t.color.red : x.status === 'IN_PROGRESS' ? t.color.orange : t.color.blue;
      const avant = (attend.get(x.id) ?? []).map(titreDe);
      const info = [
        x.title,
        p.datee ? `échéance ${jourCourt(p.fin)}` : `sans date : placée ${jourCourt(p.debut)} → ${jourCourt(p.fin)}`,
        avant.length ? `attend : ${avant.join(' ; ')}` : '',
        p.enRetard ? 'EN RETARD' : '',
        p.conflit ? 'prérequis après l’échéance' : '',
        p.dansBoucle ? 'BOUCLE de dépendances' : '',
        p.jalonSansDate ? 'JALON SANS DATE' : '',
      ]
        .filter(Boolean)
        .join(' · ');
      const contour = p.dansBoucle || p.conflit ? `2px solid ${t.color.orange}` : p.datee ? 'none' : `1px dashed ${couleur}`;
      return (
        <div key={x.id} style={{ ...grille, minHeight: '26px', borderBottom: `1px solid ${t.border.color.light}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: t.spacing[1], minWidth: 0, paddingLeft: t.spacing[6], fontSize: t.font.size.sm }}>
            <span
              style={{ ...s.tronque, cursor: 'pointer', color: p.enRetard ? t.font.color.danger : fait ? t.font.color.tertiary : t.font.color.primary }}
              onClick={() => void ouvrir('task', x.id)}
              title={info}
            >
              {x.title || 'Sans titre'}
            </span>
            {p.jalonSansDate && <span style={alerte(t.color.red)}>sans date</span>}
          </div>
          <div style={{ position: 'relative', height: '26px' }} title={info}>
            {fond}
            {p.jalon && p.datee ? (
              <div
                style={{
                  position: 'absolute',
                  top: '7px',
                  left: `calc(${pct(p.fin + JOUR / 2)} - 6px)`,
                  width: '12px',
                  height: '12px',
                  background: couleur,
                  transform: 'rotate(45deg)',
                  outline: contour === 'none' ? undefined : contour,
                }}
              />
            ) : (
              <div
                style={{
                  position: 'absolute',
                  top: '8px',
                  height: '10px',
                  left: pct(p.debut),
                  width: `max(6px, ${((p.fin + JOUR - p.debut) / etendue) * 100}%)`,
                  borderRadius: t.border.radius.sm,
                  background: p.datee ? couleur : 'transparent',
                  border: contour,
                  boxSizing: 'border-box',
                  opacity: fait ? 0.5 : 1,
                }}
              />
            )}
          </div>
        </div>
      );
    };
    return (
      <div>
        <div style={{ ...grille, position: 'sticky', top: 0, background: t.background.primary, zIndex: 1, borderBottom: `1px solid ${t.border.color.medium}` }}>
          <span style={{ ...s.badge, padding: t.spacing[2], whiteSpace: 'normal', fontSize: t.font.size.xs, overflow: 'hidden' }}>
            ◆ jalon · barre pleine : échéance · pointillés : sans date, placée après ses prérequis · rouge : en retard · trait bleu : aujourd'hui
          </span>
          <div style={{ position: 'relative', height: '28px' }}>
            {reperes.map((d) => (
              <span key={d} style={{ ...s.badge, position: 'absolute', top: '6px', left: pct(d), paddingLeft: '3px' }}>
                {jourCourt(d)}
              </span>
            ))}
          </div>
        </div>
        {groupes.map((g) => (
          <div key={g.id}>
            <div style={{ ...grille, minHeight: '28px', background: t.background.secondary }}>
              <span style={{ fontWeight: t.font.weight.semiBold, paddingLeft: t.spacing[2], color: g.categorie ? couleurCategorie(g.categorie) : t.font.color.secondary }}>
                {g.nom}
              </span>
              <div style={{ position: 'relative', height: '28px' }}>{fond}</div>
            </div>
            {[...g.taches]
              .sort((a, b) => placements.get(a.id)!.debut - placements.get(b.id)!.debut || (a.title ?? '').localeCompare(b.title ?? '', 'fr'))
              .map(ligne)}
          </div>
        ))}
      </div>
    );
  };

  const total = compter(taches ?? []);
  const aucunResultat = !!taches && !!filtre && !arbre.some(contientVisible);

  return (
    <main style={s.racine}>
      <header style={s.entete}>
        <span style={s.titre}>Projets</span>
        <span style={s.compte}>{taches ? `${total.ouvertes} tâches ouvertes sur ${total.total}` : ''}</span>
        {jalonsSansDate.length > 0 && (
          <span style={alerte(t.color.red)} title={jalonsSansDate.map((x) => x.title).join(' ; ')}>
            {jalonsSansDate.length} jalon{jalonsSansDate.length > 1 ? 's' : ''} sans date
          </span>
        )}
        {enBoucle.length > 0 && (
          <span style={alerte(t.color.red)} title={enBoucle.map((x) => x.title).join(' ; ')}>
            {enBoucle.length} tâche{enBoucle.length > 1 ? 's' : ''} en boucle
          </span>
        )}
        {signauxArgent > 0 && (
          <span style={alerte(t.color.orange)} title="Client sans encaissement prouvé, ou Prospection avec encaissé">
            {signauxArgent} dossier{signauxArgent > 1 ? 's' : ''} à reclasser
          </span>
        )}
        <span style={{ display: 'flex' }}>
          {(['arbre', 'gantt'] as Mode[]).map((m) => (
            <button
              key={m}
              style={{ ...s.bouton, ...(mode === m ? { color: t.font.color.primary, background: t.background.tertiary, fontWeight: t.font.weight.semiBold } : {}) }}
              onClick={() => setMode(m)}
              aria-pressed={mode === m}
            >
              {m === 'arbre' ? 'Arbre' : 'Gantt'}
            </button>
          ))}
        </span>
        <label style={s.recherche}>
          <IconSearch size={14} />
          <input style={s.champ} placeholder="Chercher une tâche" aria-label="Chercher une tâche" value={recherche} onChange={(e) => setRecherche(e.target.value)} />
        </label>
        <button style={s.bouton} onClick={() => setVoirFaites((v) => !v)}>
          {voirFaites ? 'Masquer les faites' : 'Voir les faites'}
        </button>
        {mode === 'arbre' && (
          <>
            <button style={s.bouton} onClick={() => setOuverts(new Set([...sections.map((x) => idSection(x.categorie)), ...tousLesIds(arbre)]))}>
              Tout déplier
            </button>
            <button style={s.bouton} onClick={() => setOuverts(new Set())}>
              Tout replier
            </button>
          </>
        )}
        <button style={s.bouton} onClick={() => void charger()} disabled={chargement}>
          {chargement ? 'Chargement…' : 'Actualiser'}
        </button>
      </header>
      <div style={s.corps}>
        {erreur ? (
          <div style={s.erreur}>
            <span>Les projets n'ont pas pu être chargés : {erreur}</span>
            <button style={s.bouton} onClick={() => void charger()}>
              Réessayer
            </button>
          </div>
        ) : !taches ? (
          <div style={s.vide}>Chargement des projets…</div>
        ) : mode === 'gantt' ? (
          rendreGantt()
        ) : (
          <>
            {sections.map(rendreSection)}
            {sansDossier && rendreDossier(sansDossier, 0)}
          </>
        )}
        {aucunResultat && <div style={s.vide}>Aucune tâche ne correspond à « {recherche} ».</div>}
      </div>
    </main>
  );
};

export default defineFrontComponent({
  universalIdentifier: ARBORESCENCE_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  name: 'arborescence-taches',
  description: 'Projets : dossiers en arbre ou en Gantt, devis et encaissé, dépendances entre tâches',
  component: Projets,
});
