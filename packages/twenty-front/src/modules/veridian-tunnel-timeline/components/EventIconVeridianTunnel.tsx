import {
  IconArrowBarToDown,
  IconCalendarEvent,
  IconCircleX,
  IconClick,
  IconEye,
  IconMailX,
  IconSend,
  IconTargetArrow,
  IconTrendingUp,
  IconWorld,
} from 'twenty-ui/display';

import {
  getVeridianTunnelPresentation,
  type VeridianTunnelIconKey,
} from '@/veridian-tunnel-timeline/utils/veridianTunnelEvent';

// Résolution clé d'icône abstraite → composant Tabler concret. Toutes ces
// icônes sont présentes dans la liste curée twenty-ui (TablerIcons.ts) — pas
// de patch de cette liste upstream.
const ICONS: Record<VeridianTunnelIconKey, (typeof IconSend)> = {
  send: IconSend,
  eye: IconEye,
  click: IconClick,
  mailX: IconMailX,
  unsubscribe: IconCircleX,
  pageView: IconWorld,
  scroll: IconArrowBarToDown,
  cta: IconTargetArrow,
  rdv: IconCalendarEvent,
  score: IconTrendingUp,
  generic: IconWorld,
};

export const EventIconVeridianTunnel = ({
  eventName,
}: {
  eventName: string;
}) => {
  const { icon } = getVeridianTunnelPresentation(eventName);
  const IconComponent = ICONS[icon];

  return <IconComponent />;
};
