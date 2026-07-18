// Veridian — module AGPL (fork twentyhq/twenty). Cockpit "fiche prospect".
//
// Panneau injecté EN TÊTE de la fiche company (au-dessus du layout méta-modélisé
// Twenty) via une accroche de 2 lignes dans PageLayoutRecordPageRenderer
// (Veridian PATCH INLINE). Reproduit le feeling de l'app legacy Prospection :
//   - téléphone du prospect EN GROS + bouton Appeler (tel:) et Email (mailto:)
//   - ligne de statut tunnel (statutColdCall) bien visible
//   - blocs compacts : Site web, Effectifs, Secteur/NAF, Localisation, SIREN, Score
//   - actions rapides : Appeler / Email / Note
//
// Composant d'AFFICHAGE pur : lectures jotai + onClick, AUCUNE écriture au
// montage (contrairement à veridian-record-open) → safe en StrictMode.
// Gating company DANS le composant (return null sinon) ; le renderer core reste
// agnostique de l'objet.

import { styled } from '@linaria/react';
import {
  IconBriefcase,
  IconChartBar,
  IconId,
  IconMail,
  IconMap,
  IconNotes,
  IconPhone,
  IconUsers,
  IconWorld,
} from 'twenty-ui-deprecated/display';
import { themeCssVariables } from 'twenty-ui-deprecated/theme-constants';

import { useVeridianProspectCardData } from '@/veridian-prospect-card/hooks/useVeridianProspectCardData';
import {
  buildMailtoHref,
  buildTelHref,
  formatLocalisation,
  formatPhoneDisplay,
  getPrimaryEmail,
  humanizeStatutColdCall,
  isVeridianProspectCardObject,
  resolveSiteWeb,
  statutColdCallColor,
} from '@/veridian-prospect-card/utils/veridianProspectCardFields';

const t = themeCssVariables;

// Résolution clé couleur (statutColdCallColor) → variable CSS de thème. Typé
// explicitement `Record<string, string>` pour garantir un `string` (l'accès
// indexé direct sur `t.color` laissait fuiter le type de l'objet entier).
const STATUT_COLOR_VAR: Record<string, string> = {
  blue: t.color.blue,
  turquoise: t.color.turquoise,
  orange: t.color.orange,
  purple: t.color.purple,
  green: t.color.green,
  red: t.color.red,
  gray: t.color.gray,
};

const StyledCard = styled.div<{ $isInSidePanel: boolean }>`
  background: ${t.background.secondary};
  border: 1px solid ${t.border.color.medium};
  border-radius: ${t.border.radius.md};
  display: flex;
  flex-direction: column;
  gap: ${t.spacing['3']};
  margin: ${t.spacing['3']};
  padding: ${(props) =>
    props.$isInSidePanel ? t.spacing['3'] : t.spacing['4']};
`;

// ─── Header : statut tunnel + nom ────────────────────────────────────────────

const StyledHeaderRow = styled.div`
  align-items: center;
  display: flex;
  gap: ${t.spacing['2']};
  justify-content: space-between;
`;

const StyledName = styled.div`
  color: ${t.font.color.secondary};
  font-size: ${t.font.size.sm};
  font-weight: ${t.font.weight.medium};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const StyledStatutBadge = styled.div`
  align-items: center;
  border-radius: ${t.border.radius.pill};
  display: inline-flex;
  flex-shrink: 0;
  font-size: ${t.font.size.xs};
  font-weight: ${t.font.weight.semiBold};
  gap: ${t.spacing['1']};
  padding: ${t.spacing['1']} ${t.spacing['2']};
`;

const StyledStatutDot = styled.span`
  border-radius: ${t.border.radius.rounded};
  height: 8px;
  width: 8px;
`;

// ─── Hero téléphone ──────────────────────────────────────────────────────────

const StyledPhoneHero = styled.div`
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: ${t.spacing['3']};
  justify-content: space-between;
`;

const StyledPhoneBlock = styled.div`
  align-items: center;
  display: flex;
  gap: ${t.spacing['2']};
  min-width: 0;
`;

const StyledPhoneNumber = styled.a`
  color: ${t.font.color.primary};
  font-size: ${t.font.size.xxl};
  font-weight: ${t.font.weight.semiBold};
  letter-spacing: 0.02em;
  text-decoration: none;
  &:hover {
    text-decoration: underline;
  }
`;

const StyledPhoneEmpty = styled.div`
  color: ${t.font.color.light};
  font-size: ${t.font.size.md};
  font-style: italic;
`;

const StyledActionsRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: ${t.spacing['2']};
`;

const StyledActionButton = styled.a<{ $variant: 'primary' | 'secondary' }>`
  align-items: center;
  background: ${(props) =>
    props.$variant === 'primary'
      ? t.color.blue
      : t.background.transparent.light};
  border: 1px solid
    ${(props) =>
      props.$variant === 'primary'
        ? t.color.blue
        : t.border.color.medium};
  border-radius: ${t.border.radius.sm};
  color: ${(props) =>
    props.$variant === 'primary'
      ? t.font.color.inverted
      : t.font.color.secondary};
  cursor: pointer;
  display: inline-flex;
  font-size: ${t.font.size.sm};
  font-weight: ${t.font.weight.medium};
  gap: ${t.spacing['1']};
  padding: ${t.spacing['2']} ${t.spacing['3']};
  text-decoration: none;
  user-select: none;
  &:hover {
    filter: brightness(0.97);
  }
`;

const StyledActionButtonDisabled = styled.div`
  align-items: center;
  background: ${t.background.transparent.light};
  border: 1px solid ${t.border.color.light};
  border-radius: ${t.border.radius.sm};
  color: ${t.font.color.light};
  cursor: not-allowed;
  display: inline-flex;
  font-size: ${t.font.size.sm};
  font-weight: ${t.font.weight.medium};
  gap: ${t.spacing['1']};
  padding: ${t.spacing['2']} ${t.spacing['3']};
  user-select: none;
`;

// ─── Grille d'infos compactes ────────────────────────────────────────────────

const StyledInfoGrid = styled.div`
  display: grid;
  gap: ${t.spacing['2']};
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
`;

const StyledInfoCell = styled.div`
  align-items: flex-start;
  border: 1px solid ${t.border.color.light};
  border-radius: ${t.border.radius.sm};
  display: flex;
  flex-direction: column;
  gap: ${t.spacing['1']};
  min-width: 0;
  padding: ${t.spacing['2']};
`;

const StyledInfoLabel = styled.div`
  align-items: center;
  color: ${t.font.color.light};
  display: flex;
  font-size: ${t.font.size.xxs};
  font-weight: ${t.font.weight.medium};
  gap: ${t.spacing['1']};
  text-transform: uppercase;
`;

const StyledInfoValue = styled.div`
  color: ${t.font.color.primary};
  font-size: ${t.font.size.sm};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
`;

const StyledInfoLink = styled.a`
  color: ${t.color.blue};
  font-size: ${t.font.size.sm};
  overflow: hidden;
  text-decoration: none;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
  &:hover {
    text-decoration: underline;
  }
`;

const StyledSkeleton = styled.div`
  background: ${t.background.transparent.light};
  border-radius: ${t.border.radius.sm};
  height: 32px;
  width: 60%;
`;

type VeridianProspectCardProps = {
  recordId: string;
  objectNameSingular: string;
  isInSidePanel: boolean;
};

type InfoCellSpec = {
  key: string;
  label: string;
  Icon: typeof IconUsers;
  value: string | null;
  link?: { url: string; label: string } | null;
};

export const VeridianProspectCard = ({
  recordId,
  objectNameSingular,
  isInSidePanel,
}: VeridianProspectCardProps) => {
  // Gating : le cockpit n'existe que sur la fiche company.
  if (!isVeridianProspectCardObject(objectNameSingular)) {
    return null;
  }

  return (
    <VeridianProspectCardContent
      recordId={recordId}
      isInSidePanel={isInSidePanel}
    />
  );
};

// Le contenu est un composant séparé pour que les hooks de lecture ne soient
// montés QUE sur company (le early-return de gating est au-dessus).
const VeridianProspectCardContent = ({
  recordId,
  isInSidePanel,
}: {
  recordId: string;
  isInSidePanel: boolean;
}) => {
  const data = useVeridianProspectCardData(recordId);

  const phoneDisplay = formatPhoneDisplay(data.phones);
  const telHref = buildTelHref(data.phones);
  const primaryEmail = getPrimaryEmail(data.emails);
  const mailtoHref = buildMailtoHref(data.emails);

  const statutLabel = humanizeStatutColdCall(data.statutColdCall);
  const statutColorKey = statutColdCallColor(data.statutColdCall);
  const statutColor: string = STATUT_COLOR_VAR[statutColorKey] ?? t.color.gray;

  const site = resolveSiteWeb(data.domainName?.primaryLinkUrl, data.siteWebUrl);
  const effectifs = data.effectifs ?? data.employees;
  const localisation = formatLocalisation(
    data.departement,
    data.commune,
    data.codePostal,
  );
  const secteurNaf = [data.secteur, data.codeNaf].filter(Boolean).join(' · ');

  // Skeleton tant que le store n'est pas peuplé (aucune donnée encore).
  const isEmptyLoading =
    data.isLoading &&
    data.name === null &&
    data.statutColdCall === null &&
    phoneDisplay === null;

  const infoCells: InfoCellSpec[] = [
    {
      key: 'site',
      label: 'Site web',
      Icon: IconWorld,
      value:
        site === null
          ? data.hasWebsite === false
            ? 'Aucun site'
            : null
          : null,
      link: site,
    },
    {
      key: 'effectifs',
      label: 'Effectifs',
      Icon: IconUsers,
      value:
        effectifs !== null && effectifs !== undefined
          ? String(effectifs)
          : null,
    },
    {
      key: 'secteur',
      label: 'Secteur / NAF',
      Icon: IconBriefcase,
      value: secteurNaf !== '' ? secteurNaf : null,
    },
    {
      key: 'localisation',
      label: 'Localisation',
      Icon: IconMap,
      value: localisation,
    },
    {
      key: 'siren',
      label: 'SIREN',
      Icon: IconId,
      value: data.siren?.trim() ? data.siren.trim() : null,
    },
    {
      key: 'score',
      label: 'Score',
      Icon: IconChartBar,
      value:
        data.prospectScore !== null && data.prospectScore !== undefined
          ? String(data.prospectScore)
          : null,
    },
  ];

  const visibleCells = infoCells.filter(
    (cell) => cell.value !== null || (cell.link ?? null) !== null,
  );

  if (isEmptyLoading) {
    return (
      <StyledCard $isInSidePanel={isInSidePanel}>
        <StyledSkeleton />
      </StyledCard>
    );
  }

  return (
    <StyledCard $isInSidePanel={isInSidePanel}>
      <StyledHeaderRow>
        {data.name ? <StyledName>{data.name}</StyledName> : <span />}
        {statutLabel && (
          <StyledStatutBadge
            style={{
              backgroundColor: t.background.transparent.light,
              color: statutColor,
              border: `1px solid ${statutColor}`,
            }}
          >
            <StyledStatutDot style={{ backgroundColor: statutColor }} />
            {statutLabel}
          </StyledStatutBadge>
        )}
      </StyledHeaderRow>

      <StyledPhoneHero>
        <StyledPhoneBlock>
          <IconPhone size={24} color={t.font.color.tertiary} />
          {phoneDisplay && telHref ? (
            <StyledPhoneNumber href={telHref}>{phoneDisplay}</StyledPhoneNumber>
          ) : (
            <StyledPhoneEmpty>Aucun téléphone</StyledPhoneEmpty>
          )}
        </StyledPhoneBlock>

        <StyledActionsRow>
          {telHref && (
            <StyledActionButton $variant="primary" href={telHref}>
              <IconPhone size={16} color={t.font.color.inverted} />
              Appeler
            </StyledActionButton>
          )}
          {mailtoHref ? (
            <StyledActionButton $variant="secondary" href={mailtoHref}>
              <IconMail size={16} color={t.font.color.secondary} />
              Email
            </StyledActionButton>
          ) : (
            <StyledActionButtonDisabled title="Aucune adresse email">
              <IconMail size={16} color={t.font.color.light} />
              Email
            </StyledActionButtonDisabled>
          )}
          {/* Note : bouton visuel (création de note native non câblée ici pour
              rester un composant d'affichage pur ; l'onglet Notes du record
              reste accessible plus bas dans le layout Twenty). */}
          <StyledActionButtonDisabled title="Utiliser l'onglet Notes de la fiche">
            <IconNotes size={16} color={t.font.color.light} />
            Note
          </StyledActionButtonDisabled>
        </StyledActionsRow>
      </StyledPhoneHero>

      {primaryEmail && <StyledName>{primaryEmail}</StyledName>}

      {visibleCells.length > 0 && (
        <StyledInfoGrid>
          {visibleCells.map(({ key, label, Icon, value, link }) => (
            <StyledInfoCell key={key}>
              <StyledInfoLabel>
                <Icon size={12} color={t.font.color.light} />
                {label}
              </StyledInfoLabel>
              {link ? (
                <StyledInfoLink
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={link.label}
                >
                  {link.label}
                </StyledInfoLink>
              ) : (
                <StyledInfoValue title={value ?? undefined}>
                  {value}
                </StyledInfoValue>
              )}
            </StyledInfoCell>
          ))}
        </StyledInfoGrid>
      )}
    </StyledCard>
  );
};
