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
import { type Importance, importanceSuivante, LIBELLES_IMPORTANCE } from '../utils/importance.util';

const STATUTS: Record<string, { libelle: string; suivant: string }> = {
  TODO: { libelle: 'À faire', suivant: 'IN_PROGRESS' },
  IN_PROGRESS: { libelle: 'En cours', suivant: 'DONE' },
  DONE: { libelle: 'Fait', suivant: 'TODO' },
};

const messageErreur = (e: unknown) => (e instanceof Error ? e.message : String(e));
const signaler = (message: string) => void enqueueSnackbar({ message, variant: 'error' } as any);

const toutLire = async <T,>(objet: string, champs: Record<string, true>): Promise<T[]> => {
  const client = new CoreApiClient();
  const lignes: T[] = [];
  let apres: string | undefined;
  for (let page = 0; page < 50; page++) {
    const reponse = await client.query({
      [objet]: {
        __args: { first: 100, ...(apres ? { after: apres } : {}) },
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

const ouvrir = (objectNameSingular: 'task' | 'dossier', id: string) =>
  openSidePanelPage({ page: SidePanelPages.ViewRecord, recordId: id, objectNameSingular });

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

const Arborescence = () => {
  const t = useTheme();
  const [taches, setTaches] = useState<Tache[] | null>(null);
  const [dossiers, setDossiers] = useState<DossierBrut[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  const [voirFaites, setVoirFaites] = useState(false);
  const [recherche, setRecherche] = useState('');
  const [ouverts, setOuverts] = useState<Set<string> | null>(null);
  const [listes, setListes] = useState<VueListe[]>([]);

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
      const [ds, ts] = await Promise.all([
        toutLire<DossierBrut>('dossiers', {
          id: true,
          nom: true,
          importance: true,
          categorie: true,
          parentId: true,
          societeId: true,
        }),
        toutLire<Tache>('tasks', {
          id: true,
          title: true,
          status: true,
          dueAt: true,
          importance: true,
          suiviAvancement: true,
          rangementId: true,
        }),
      ]);
      setDossiers(ds);
      setTaches(ts);
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
      await new CoreApiClient().mutation({ updateTask: { __args: { id: tache.id, data: data as any }, id: true } });
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
      const { createTask } = await new CoreApiClient().mutation({ createTask: { __args: { data: data as any }, id: true } });
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
      <div
        style={{
          flex: 1,
          height: '6px',
          borderRadius: t.border.radius.pill,
          background: t.background.tertiary,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pourcent ?? 0}%`,
            height: '100%',
            background: pourcent === 100 ? t.color.green : t.color.blue,
          }}
        />
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

  const couleurCategorie = (c: Categorie) =>
    c === 'CLIENT' ? t.color.green : c === 'PROSPECTION' ? t.color.orange : t.color.purple;

  const rendreTache = (tache: Tache, niveau: number) => (
    <div key={tache.id} style={{ ...s.ligneTache, paddingLeft: retrait(niveau) }}>
      <button
        style={pastille(
          tache.status === 'DONE' ? t.font.color.tertiary : tache.status === 'IN_PROGRESS' ? t.color.orange : t.color.blue,
        )}
        onClick={() => void majTache(tache, { status: STATUTS[tache.status ?? 'TODO']?.suivant ?? 'TODO' })}
        title="Statut : cliquer pour avancer"
      >
        {STATUTS[tache.status ?? 'TODO']?.libelle ?? tache.status}
      </button>
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
      <Importance valeur={tache.importance} onClic={() => void majTache(tache, { importance: importanceSuivante(tache.importance) })} />
      <Barre
        pourcent={avancementTache(tache)}
        titre={tache.status === 'DONE' ? 'Faite : 100 %' : 'Avancement : cliquer pour +25 %'}
        onClic={tache.status === 'DONE' ? undefined : () => void majTache(tache, { suiviAvancement: avancementSuivant(tache.suiviAvancement) })}
      />
      {echeance(tache)}
    </div>
  );

  const rendreDossier = (n: Noeud, niveau: number): ReactElement | null => {
    if (filtre && !contientVisible(n)) return null;
    const ouvert = filtre ? true : estOuvert(n.id);
    const c = compter(toutesLesTaches(n));
    const tachesVisibles = n.taches.filter(tacheVisible);
    const taille = niveau === 0 ? t.font.size.md : t.font.size.md;
    return (
      <div key={n.id} style={{ marginBottom: niveau === 0 ? t.spacing[1] : 0 }}>
        <div style={{ ...s.ligneDossier, paddingLeft: retrait(niveau) }} onClick={() => basculer(n.id)}>
          <div style={{ ...s.nomDossier, fontSize: taille, fontWeight: niveau === 0 ? t.font.weight.semiBold : t.font.weight.medium }}>
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
            {n.enfants.map((e) => rendreDossier(e, niveau + 1))}
            {tachesVisibles.map((x) => rendreTache(x, niveau + 1))}
            {n.enfants.length === 0 && tachesVisibles.length === 0 && (
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
                    <button
                      key={v.id}
                      style={pastille(t.color.orange)}
                      onClick={() => void ouvrirVueSocietes(v.id)}
                      aria-label={`Ouvrir ${l} ${v.variante}`}
                    >
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

  const total = compter(taches ?? []);
  const aucunResultat = !!taches && !!filtre && !arbre.some(contientVisible);

  return (
    <main style={s.racine}>
      <header style={s.entete}>
        <span style={s.titre}>Tâches</span>
        <span style={s.compte}>{taches ? `${total.ouvertes} ouvertes sur ${total.total}` : ''}</span>
        <label style={s.recherche}>
          <IconSearch size={14} />
          <input
            style={s.champ}
            placeholder="Chercher une tâche"
            aria-label="Chercher une tâche"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
          />
        </label>
        <button style={s.bouton} onClick={() => setVoirFaites((v) => !v)}>
          {voirFaites ? 'Masquer les faites' : 'Voir les faites'}
        </button>
        <button
          style={s.bouton}
          onClick={() => setOuverts(new Set([...sections.map((x) => idSection(x.categorie)), ...tousLesIds(arbre)]))}
        >
          Tout déplier
        </button>
        <button style={s.bouton} onClick={() => setOuverts(new Set())}>
          Tout replier
        </button>
        <button style={s.bouton} onClick={() => void charger()} disabled={chargement}>
          {chargement ? 'Chargement…' : 'Actualiser'}
        </button>
      </header>
      <div style={s.corps}>
        {erreur ? (
          <div style={s.erreur}>
            <span>Les tâches n'ont pas pu être chargées : {erreur}</span>
            <button style={s.bouton} onClick={() => void charger()}>
              Réessayer
            </button>
          </div>
        ) : !taches ? (
          <div style={s.vide}>Chargement des tâches…</div>
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
  description: 'Les tâches rangées en dossiers, avec importance et avancement',
  component: Arborescence,
});
