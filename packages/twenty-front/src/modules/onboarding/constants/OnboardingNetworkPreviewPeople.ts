export const ONBOARDING_NETWORK_PREVIEW_PEOPLE = [3, 5, 22, 20, 34].map(
  (imageNumber) => ({
    id: `network-preview-person-${imageNumber}`,
    // Veridian : pas d'appel à twentyhq.github.io, l'avatar retombe sur les initiales.
    avatarUrl: '',
  }),
);
