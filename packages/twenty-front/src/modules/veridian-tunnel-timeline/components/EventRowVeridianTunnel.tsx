import { styled } from '@linaria/react';

import { EventRowItem } from '@/activities/timeline-activities/rows/components/EventRowItem';
import { type TimelineActivity } from '@/activities/timeline-activities/types/TimelineActivity';
import { useAtomStateValue } from '@/ui/utilities/state/jotai/hooks/useAtomStateValue';
import { MOBILE_VIEWPORT, themeCssVariables } from 'twenty-ui-deprecated/theme-constants';
import { dateLocaleState } from '~/localization/states/dateLocaleState';
import { beautifyPastDateRelativeToNow } from '~/utils/date-utils';

import {
  getVeridianTunnelDetails,
  getVeridianTunnelHappensAt,
  getVeridianTunnelPresentation,
} from '@/veridian-tunnel-timeline/utils/veridianTunnelEvent';

const StyledMainContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${themeCssVariables.spacing[1]};
  width: 100%;
`;

const StyledRowContainer = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[1]};
  justify-content: space-between;
`;

const StyledRow = styled.div`
  align-items: center;
  display: flex;
  gap: ${themeCssVariables.spacing[1]};
  overflow: hidden;
`;

const StyledItemTitleDate = styled.div`
  @media (max-width: ${MOBILE_VIEWPORT}px) {
    display: none;
  }
  color: ${themeCssVariables.font.color.tertiary};
  flex-shrink: 0;
  padding: 0 ${themeCssVariables.spacing[1]};
`;

const StyledDetails = styled.div`
  color: ${themeCssVariables.font.color.tertiary};
  display: flex;
  flex-wrap: wrap;
  font-size: ${themeCssVariables.font.size.xs};
  gap: ${themeCssVariables.spacing[2]};
  white-space: normal;
`;

const StyledDetail = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
`;

const StyledDetailLabel = styled.span`
  color: ${themeCssVariables.font.color.light};
`;

type EventRowVeridianTunnelProps = {
  event: TimelineActivity;
};

export const EventRowVeridianTunnel = ({
  event,
}: EventRowVeridianTunnelProps) => {
  const { localeCatalog } = useAtomStateValue(dateLocaleState);

  const { label } = getVeridianTunnelPresentation(event.name);
  const details = getVeridianTunnelDetails(event.properties);
  const happensAt = getVeridianTunnelHappensAt(event);
  const beautifiedDate = happensAt
    ? beautifyPastDateRelativeToNow(happensAt, localeCatalog)
    : '';

  return (
    <StyledMainContainer>
      <StyledRowContainer>
        <StyledRow>
          <EventRowItem>{label}</EventRowItem>
        </StyledRow>
        <StyledItemTitleDate>{beautifiedDate}</StyledItemTitleDate>
      </StyledRowContainer>
      {details.length > 0 && (
        <StyledDetails>
          {details.map((detail) => (
            <StyledDetail key={detail.key}>
              <StyledDetailLabel>{detail.label} : </StyledDetailLabel>
              {detail.value}
            </StyledDetail>
          ))}
        </StyledDetails>
      )}
    </StyledMainContainer>
  );
};
