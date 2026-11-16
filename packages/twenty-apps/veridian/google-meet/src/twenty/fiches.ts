import type { Cible, ObjetCible } from '../types/meet.types';
import { type ChampEmails, emailsDuChamp, normaliserEmails } from '../utils/emails.util';
import { graphql } from './graphql';

// Ce qu'il faut savoir d'une fiche pour y créer un Meet : un nom, des adresses proposées, les fiches à relier.

export type Invite = { email: string; libelle: string };
export type ContexteFiche = { nom: string; invites: Invite[]; cibles: Cible[] };

type Nom = { firstName?: string | null; lastName?: string | null } | null;
type Personne = { id: string; name: Nom; emails: ChampEmails };

const nomComplet = (n: Nom): string => [n?.firstName, n?.lastName].filter(Boolean).join(' ').trim();

const invitesDe = (personnes: Personne[]): Invite[] =>
  personnes.flatMap((p) => emailsDuChamp(p.emails).map((email) => ({ email, libelle: nomComplet(p.name) || email })));

const PERSONNE = `query P($id: UUID!) { person(filter: { id: { eq: $id } }) {
  id name { firstName lastName } emails { primaryEmail additionalEmails } companyId } }`;

const SOCIETE = `query S($id: UUID!) { company(filter: { id: { eq: $id } }) {
  id name people(first: 60) { edges { node { id name { firstName lastName } emails { primaryEmail additionalEmails } } } } } }`;

const DOSSIER = `query D($id: UUID!) { dossier(filter: { id: { eq: $id } }) {
  id nom societe { id name people(first: 60) { edges { node { id name { firstName lastName } emails { primaryEmail additionalEmails } } } } } } }`;

type Aretes<T> = { edges: Array<{ node: T }> };
type SocieteBrute = { id: string; name: string | null; people: Aretes<Personne> };

export const chargerContexte = async (objet: ObjetCible, id: string): Promise<ContexteFiche> => {
  if (objet === 'person') {
    const { person } = await graphql<{ person: (Personne & { companyId: string | null }) | null }>('core', PERSONNE, { id });
    if (!person) throw new Error('Personne introuvable');
    return {
      nom: nomComplet(person.name) || 'Contact',
      invites: invitesDe([person]),
      cibles: [{ objet: 'person', id }, ...(person.companyId ? [{ objet: 'company' as const, id: person.companyId }] : [])],
    };
  }
  if (objet === 'company') {
    const { company } = await graphql<{ company: SocieteBrute | null }>('core', SOCIETE, { id });
    if (!company) throw new Error('Société introuvable');
    return {
      nom: company.name ?? 'Société',
      invites: invitesDe(company.people.edges.map((e) => e.node)),
      cibles: [{ objet: 'company', id }],
    };
  }
  const { dossier } = await graphql<{ dossier: { id: string; nom: string | null; societe: SocieteBrute | null } | null }>(
    'core',
    DOSSIER,
    { id },
  );
  if (!dossier) throw new Error('Dossier introuvable');
  return {
    nom: dossier.nom ?? dossier.societe?.name ?? 'Dossier',
    invites: dossier.societe ? invitesDe(dossier.societe.people.edges.map((e) => e.node)) : [],
    cibles: [{ objet: 'dossier', id }, ...(dossier.societe ? [{ objet: 'company' as const, id: dossier.societe.id }] : [])],
  };
};

const PAR_EMAIL = `query E($emails: [String!]) { people(first: 100, filter: { emails: { primaryEmail: { in: $emails } } }) {
  edges { node { id } } } }`;

// Les personnes du CRM dont l'adresse principale est invitée : la note du Meet s'affiche aussi sur leur fiche.
export const personnesParEmail = async (emails: string[]): Promise<string[]> => {
  const liste = normaliserEmails(emails);
  if (liste.length === 0) return [];
  const { people } = await graphql<{ people: Aretes<{ id: string }> }>('core', PAR_EMAIL, { emails: liste });
  return people.edges.map((e) => e.node.id);
};
