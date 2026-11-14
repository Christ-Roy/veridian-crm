import { type CSSProperties, useCallback, useEffect, useMemo, useState } from 'react';
import { CoreApiClient } from 'twenty-client-sdk/core';
import { MetadataApiClient } from 'twenty-client-sdk/metadata';
import { defineFrontComponent } from 'twenty-sdk/define';
import { enqueueSnackbar, openSidePanelPage, SidePanelPages } from 'twenty-sdk/front-component';
import { IconChevronDown, IconChevronRight, IconFolder, IconFolderOpen, IconPlus, IconSearch } from 'twenty-ui/icon';
import { useTheme } from 'twenty-ui/theme';

import { ARBORESCENCE_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER } from '../identifiants';
import {
  compter,
  construireArbre,
  type Dossier,
  type OptionDossier,
  SANS_DOSSIER,
  type SousDossier,
  type Tache,
} from '../utils/construire-arbre.util';

const STATUTS: Record<string, { libelle: string; suivant: string }> = {
  TODO: { libelle: 'À faire', suivant: 'IN_PROGRESS' },
  IN_PROGRESS: { libelle: 'En cours', suivant: 'DONE' },
  DONE: { libelle: 'Fait', suivant: 'TODO' },
};

const messageErreur = (e: unknown) => (e instanceof Error ? e.message : String(e));

const chargerTaches = async (): Promise<Tache[]> => {
  const client = new CoreApiClient();
  const taches: Tache[] = [];
  let apres: string | undefined;
  for (let page = 0; page < 50; page++) {
    const { tasks } = await client.query({
      tasks: {
        __args: { first: 100, ...(apres ? { after: apres } : {}) },
        edges: { node: { id: true, title: true, status: true, dueAt: true, dossier: true } },
        pageInfo: { hasNextPage: true, endCursor: true },
      },
    });
    for (const edge of tasks?.edges ?? []) taches.push(edge.node as Tache);
    if (!tasks?.pageInfo?.hasNextPage) break;
    apres = tasks.pageInfo.endCursor;
  }
  return taches;
};

const chargerOptions = async (): Promise<OptionDossier[]> => {
  const { objects } = await new MetadataApiClient().query({
    objects: {
      __args: { filter: {}, paging: { first: 200 } },
      edges: {
        node: {
          nameSingular: true,
          fields: { __args: { filter: {}, paging: { first: 300 } }, edges: { node: { name: true, options: true } } },
        },
      },
    },
  });
  const task = (objects?.edges ?? []).find((e: any) => e.node.nameSingular === 'task')?.node;
  const champ = (task?.fields?.edges ?? []).find((e: any) => e.node.name === 'dossier')?.node;
  return ((champ?.options ?? []) as any[])
    .filter((o) => o.isActive !== false)
    .map((o) => ({ value: o.value, label: o.label, position: o.position ?? 0 }));
};

const ouvrirTache = (id: string) =>
  openSidePanelPage({ page: SidePanelPages.ViewRecord, recordId: id, objectNameSingular: 'task' });

const Arborescence = () => {
  const t = useTheme();
  const [taches, setTaches] = useState<Tache[] | null>(null);
  const [options, setOptions] = useState<OptionDossier[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);
  const [voirFaites, setVoirFaites] = useState(false);
  const [recherche, setRecherche] = useState('');
  const [ouverts, setOuverts] = useState<Set<string> | null>(null);

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      const [ts, os] = await Promise.all([chargerTaches(), chargerOptions()]);
      setTaches(ts);
      setOptions(os);
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    void charger();
  }, [charger]);

  const arbre = useMemo(() => construireArbre(taches ?? [], options), [taches, options]);

  // Par défaut : sujets ouverts, sous-dossiers fermés (on voit d'abord la liste des dossiers).
  const estOuvert = (cle: string, parDefaut: boolean) => (ouverts ? ouverts.has(cle) : parDefaut);
  const basculer = (cle: string, parDefaut: boolean) => {
    const base = ouverts ?? new Set(arbre.map((d) => d.cle));
    const suivant = new Set(base);
    if (estOuvert(cle, parDefaut)) suivant.delete(cle);
    else suivant.add(cle);
    setOuverts(suivant);
  };
  const toutDeplier = () => setOuverts(new Set(arbre.flatMap((d) => [d.cle, ...d.sousDossiers.map((x) => x.cle)])));
  const toutReplier = () => setOuverts(new Set());

  const filtre = recherche.trim().toLowerCase();
  const visibles = (sous: SousDossier) =>
    sous.taches.filter(
      (x) => (voirFaites || x.status !== 'DONE') && (!filtre || (x.title ?? '').toLowerCase().includes(filtre)),
    );

  const changerStatut = async (tache: Tache) => {
    const suivant = STATUTS[tache.status ?? 'TODO']?.suivant ?? 'TODO';
    setTaches((prec) => (prec ?? []).map((x) => (x.id === tache.id ? { ...x, status: suivant } : x)));
    try {
      await new CoreApiClient().mutation({
        updateTask: { __args: { id: tache.id, data: { status: suivant as any } }, id: true },
      });
    } catch (e) {
      setTaches((prec) => (prec ?? []).map((x) => (x.id === tache.id ? tache : x)));
      void enqueueSnackbar({ message: `Statut non enregistré : ${messageErreur(e)}`, variant: 'error' } as any);
    }
  };

  const creerDans = async (sous: SousDossier) => {
    try {
      const data: Record<string, unknown> = { title: 'Nouvelle tâche', status: 'TODO' };
      if (sous.cle !== SANS_DOSSIER) data.dossier = sous.cle;
      const { createTask } = await new CoreApiClient().mutation({ createTask: { __args: { data }, id: true } });
      setOuverts(new Set([...(ouverts ?? arbre.map((d) => d.cle)), sous.cle]));
      await charger();
      if (createTask?.id) await ouvrirTache(createTask.id);
    } catch (e) {
      void enqueueSnackbar({ message: `Tâche non créée : ${messageErreur(e)}`, variant: 'error' } as any);
    }
  };

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
    ligneSujet: {
      display: 'flex',
      alignItems: 'center',
      gap: t.spacing[2],
      padding: t.spacing[2],
      cursor: 'pointer',
      fontWeight: t.font.weight.semiBold,
      fontSize: t.font.size.md,
    },
    ligneSous: {
      display: 'flex',
      alignItems: 'center',
      gap: t.spacing[2],
      padding: `${t.spacing[1]} ${t.spacing[2]} ${t.spacing[1]} ${t.spacing[8]}`,
      cursor: 'pointer',
      fontWeight: t.font.weight.medium,
      fontSize: t.font.size.md,
    },
    ligneTache: {
      display: 'grid',
      gridTemplateColumns: '84px minmax(0, 1fr) auto',
      alignItems: 'center',
      gap: t.spacing[3],
      padding: `${t.spacing[1]} ${t.spacing[3]} ${t.spacing[1]} ${t.spacing[12]}`,
      fontSize: t.font.size.md,
      borderBottom: `1px solid ${t.border.color.light}`,
    },
    badge: { color: t.font.color.tertiary, fontSize: t.font.size.sm, fontWeight: t.font.weight.regular },
    aucune: {
      color: t.font.color.tertiary,
      fontSize: t.font.size.sm,
      padding: `${t.spacing[1]} 0 ${t.spacing[2]} ${t.spacing[12]}`,
    },
    titreTache: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' },
    plus: {
      marginLeft: 'auto',
      border: 'none',
      background: 'transparent',
      color: t.font.color.tertiary,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: t.spacing[1],
      fontSize: t.font.size.sm,
      fontFamily: t.font.family,
    },
    vide: { padding: t.spacing[8], textAlign: 'center', color: t.font.color.tertiary },
    erreur: { padding: t.spacing[6], color: t.font.color.danger, display: 'grid', gap: t.spacing[3], justifyItems: 'start' },
  };

  const pastille = (statut: string | null): CSSProperties => ({
    border: `1px solid ${t.border.color.medium}`,
    borderRadius: t.border.radius.pill,
    fontSize: t.font.size.xs,
    padding: `2px ${t.spacing[2]}`,
    cursor: 'pointer',
    textAlign: 'center',
    background: 'transparent',
    fontFamily: t.font.family,
    color: statut === 'DONE' ? t.font.color.tertiary : statut === 'IN_PROGRESS' ? t.color.orange : t.color.blue,
  });

  const echeance = (tache: Tache) => {
    if (!tache.dueAt) return <span />;
    const date = new Date(tache.dueAt);
    const enRetard = tache.status !== 'DONE' && date.getTime() < Date.now();
    return (
      <span style={{ fontSize: t.font.size.sm, color: enRetard ? t.font.color.danger : t.font.color.tertiary }}>
        {date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
      </span>
    );
  };

  const total = compter(taches ?? []);

  const rendreSous = (sous: SousDossier) => {
    const liste = visibles(sous);
    if (filtre && liste.length === 0) return null;
    const ouvert = filtre ? true : estOuvert(sous.cle, false);
    const c = compter(sous.taches);
    return (
      <div key={sous.cle}>
        <div style={s.ligneSous} onClick={() => basculer(sous.cle, false)}>
          {ouvert ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          {ouvert ? <IconFolderOpen size={16} /> : <IconFolder size={16} />}
          <span>{sous.libelle}</span>
          <span style={s.badge}>
            {c.ouvertes} / {c.total}
          </span>
          <button
            style={s.plus}
            title="Nouvelle tâche dans ce dossier"
            aria-label={`Nouvelle tâche dans ${sous.libelle}`}
            onClick={(e) => {
              e.stopPropagation();
              void creerDans(sous);
            }}
          >
            <IconPlus size={14} /> Tâche
          </button>
        </div>
        {ouvert &&
          (liste.length === 0 ? (
            <div style={s.aucune}>{voirFaites ? 'Aucune tâche' : 'Aucune tâche ouverte'}</div>
          ) : (
            liste.map((tache) => (
              <div key={tache.id} style={s.ligneTache}>
                <button style={pastille(tache.status)} onClick={() => void changerStatut(tache)} title="Changer le statut">
                  {STATUTS[tache.status ?? 'TODO']?.libelle ?? tache.status}
                </button>
                <span
                  style={{
                    ...s.titreTache,
                    color: tache.status === 'DONE' ? t.font.color.tertiary : t.font.color.primary,
                    textDecoration: tache.status === 'DONE' ? 'line-through' : 'none',
                  }}
                  onClick={() => void ouvrirTache(tache.id)}
                  title={tache.title ?? ''}
                >
                  {tache.title || 'Sans titre'}
                </span>
                {echeance(tache)}
              </div>
            ))
          ))}
      </div>
    );
  };

  const rendreSujet = (dossier: Dossier) => {
    const sous = dossier.sousDossiers.map(rendreSous).filter(Boolean);
    if (filtre && sous.length === 0) return null;
    const ouvert = filtre ? true : estOuvert(dossier.cle, true);
    const c = compter(dossier.sousDossiers.flatMap((x) => x.taches));
    return (
      <div key={dossier.cle} style={{ marginBottom: t.spacing[1] }}>
        <div style={s.ligneSujet} onClick={() => basculer(dossier.cle, true)}>
          {ouvert ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
          {ouvert ? <IconFolderOpen size={18} /> : <IconFolder size={18} />}
          <span>{dossier.libelle}</span>
          <span style={s.badge}>
            {c.ouvertes} ouvertes / {c.total}
          </span>
        </div>
        {ouvert && sous}
      </div>
    );
  };

  const aucunResultat =
    !!taches && !!filtre && arbre.every((d) => d.sousDossiers.every((x) => visibles(x).length === 0));

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
        <button style={s.bouton} onClick={toutDeplier}>
          Tout déplier
        </button>
        <button style={s.bouton} onClick={toutReplier}>
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
        ) : arbre.length === 0 ? (
          <div style={s.vide}>Aucun dossier : ajoute des options au champ « Dossier » des tâches.</div>
        ) : (
          arbre.map(rendreSujet)
        )}
        {aucunResultat && <div style={s.vide}>Aucune tâche ne correspond à « {recherche} ».</div>}
      </div>
    </main>
  );
};

export default defineFrontComponent({
  universalIdentifier: ARBORESCENCE_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER,
  name: 'arborescence-taches',
  description: 'Les tâches rangées en dossiers : sujet, sous-sujet, puis tâches',
  component: Arborescence,
});
