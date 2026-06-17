import { render } from '@testing-library/react';

import { VeridianRecordOpenIndicator } from '@/veridian-record-open/components/VeridianRecordOpenIndicator';
import { VERIDIAN_RECORD_OPEN_DELAY_MS } from '@/veridian-record-open/utils/buildRecordOpenInput';

// Veridian (cf VERIDIAN-PATCHES.md) : overlay d'animation de la fenêtre
// d'annulation 5s (glow + barre de progression). On vérifie le contrat : le
// host est présent + la durée d'animation est pilotée par la CSS custom property
// dérivée de VERIDIAN_RECORD_OPEN_DELAY_MS (source de vérité unique, pas de 5000
// dupliqué en CSS). Les styles Linaria ne sont pas extraits en jsdom : on ne
// teste donc PAS les couleurs/keyframes, seulement le câblage.

describe('VeridianRecordOpenIndicator', () => {
  it('rend le host de l\'indicateur', () => {
    const { getByTestId } = render(<VeridianRecordOpenIndicator />);
    expect(getByTestId('veridian-record-open-indicator')).toBeInTheDocument();
  });

  it('pose la durée d\'animation depuis VERIDIAN_RECORD_OPEN_DELAY_MS (CSS var)', () => {
    const { getByTestId } = render(<VeridianRecordOpenIndicator />);
    const host = getByTestId('veridian-record-open-indicator');
    expect(host.style.getPropertyValue('--veridian-open-duration')).toBe(
      `${VERIDIAN_RECORD_OPEN_DELAY_MS}ms`,
    );
  });

  it('est décoratif (aria-hidden) — pas annoncé aux lecteurs d\'écran', () => {
    const { getByTestId } = render(<VeridianRecordOpenIndicator />);
    expect(
      getByTestId('veridian-record-open-indicator'),
    ).toHaveAttribute('aria-hidden', 'true');
  });
});
