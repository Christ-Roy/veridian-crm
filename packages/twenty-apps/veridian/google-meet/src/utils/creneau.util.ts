// Créneau proposé par défaut : la prochaine demi-heure pleine, à l'heure de Paris, au moins 15 min devant.

const partiesParis = (t: number): { date: string; heure: string } => {
  const p = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(t));
  const v = (type: string): string => p.find((x) => x.type === type)?.value ?? '00';
  return { date: `${v('year')}-${v('month')}-${v('day')}`, heure: `${v('hour')}:${v('minute')}` };
};

export const creneauParDefaut = (maintenant: number): { date: string; heure: string } => {
  const demiHeure = 30 * 60_000;
  const cible = Math.ceil((maintenant + 15 * 60_000) / demiHeure) * demiHeure;
  return partiesParis(cible);
};

export const formatDateHeure = (iso: string | null): string => {
  if (!iso) return '?';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '?';
  const { date, heure } = partiesParis(t);
  const [a, m, j] = date.split('-');
  return `${j}/${m}/${a} ${heure}`;
};

export const dateLocale = (date: string, heure: string): string => `${date}T${heure}:00`;
