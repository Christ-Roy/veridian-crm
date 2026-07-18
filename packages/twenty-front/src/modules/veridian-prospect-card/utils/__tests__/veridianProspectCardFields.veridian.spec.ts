import { type FieldPhonesValue } from '@/object-record/record-field/ui/types/FieldMetadata';
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

// Veridian (cf VERIDIAN-PATCHES.md) : logique pure du cockpit "fiche prospect".
// Gating company + construction des href tel:/mailto:/site + humanisation du
// statut tunnel. Aucune dépendance React → testable isolément.

describe('veridianProspectCardFields (Veridian prospect-card)', () => {
  describe('isVeridianProspectCardObject', () => {
    it('gate uniquement company', () => {
      expect(isVeridianProspectCardObject('company')).toBe(true);
      expect(isVeridianProspectCardObject('person')).toBe(false);
      expect(isVeridianProspectCardObject('opportunity')).toBe(false);
    });
  });

  describe('humanizeStatutColdCall', () => {
    it('mappe les valeurs connues en FR', () => {
      expect(humanizeStatutColdCall('A_APPELER')).toBe('À appeler');
      expect(humanizeStatutColdCall('FICHE_OUVERTE')).toBe('Fiche ouverte');
      expect(humanizeStatutColdCall('QUALIFIE')).toBe('Qualifié');
    });

    it('humanise proprement une valeur inconnue', () => {
      expect(humanizeStatutColdCall('EN_ATTENTE_RELANCE')).toBe(
        'En attente relance',
      );
    });

    it('renvoie null pour vide/absent', () => {
      expect(humanizeStatutColdCall(null)).toBeNull();
      expect(humanizeStatutColdCall(undefined)).toBeNull();
      expect(humanizeStatutColdCall('')).toBeNull();
    });
  });

  describe('statutColdCallColor', () => {
    it('associe une couleur aux statuts connus, gray sinon', () => {
      expect(statutColdCallColor('A_APPELER')).toBe('blue');
      expect(statutColdCallColor('QUALIFIE')).toBe('green');
      expect(statutColdCallColor('PAS_INTERESSE')).toBe('red');
      expect(statutColdCallColor('INCONNU')).toBe('gray');
      expect(statutColdCallColor(null)).toBe('gray');
    });
  });

  describe('téléphone', () => {
    const phone: FieldPhonesValue = {
      primaryPhoneNumber: '6 12 34 56 78',
      primaryPhoneCountryCode: 'FR',
      primaryPhoneCallingCode: '+33',
    };

    it('formate le numéro avec calling code pour affichage', () => {
      expect(formatPhoneDisplay(phone)).toBe('+33 6 12 34 56 78');
    });

    it('construit un href tel: en E.164 sans espaces', () => {
      expect(buildTelHref(phone)).toBe('tel:+33612345678');
    });

    it('ajoute le + manquant au calling code', () => {
      expect(
        buildTelHref({ ...phone, primaryPhoneCallingCode: '33' }),
      ).toBe('tel:+33612345678');
    });

    it('renvoie null quand pas de numéro', () => {
      expect(buildTelHref(null)).toBeNull();
      expect(formatPhoneDisplay(null)).toBeNull();
      expect(
        buildTelHref({
          primaryPhoneNumber: '   ',
          primaryPhoneCountryCode: 'FR',
        }),
      ).toBeNull();
    });
  });

  describe('email', () => {
    it('extrait l’email primaire et le href mailto:', () => {
      const emails = { primaryEmail: 'contact@acme.fr', additionalEmails: null };
      expect(getPrimaryEmail(emails)).toBe('contact@acme.fr');
      expect(buildMailtoHref(emails)).toBe('mailto:contact@acme.fr');
    });

    it('renvoie null quand pas d’email', () => {
      expect(getPrimaryEmail(null)).toBeNull();
      expect(buildMailtoHref({ primaryEmail: '', additionalEmails: null })).toBeNull();
    });
  });

  describe('resolveSiteWeb', () => {
    it('préfixe https:// et nettoie le label', () => {
      expect(resolveSiteWeb('acme.fr', null)).toEqual({
        url: 'https://acme.fr',
        label: 'acme.fr',
      });
    });

    it('garde une URL déjà absolue et retire le trailing slash du label', () => {
      expect(resolveSiteWeb('https://acme.fr/', null)).toEqual({
        url: 'https://acme.fr/',
        label: 'acme.fr',
      });
    });

    it('tombe sur le fallback siteWebUrl si domainName vide', () => {
      expect(resolveSiteWeb(null, 'https://fallback.fr')).toEqual({
        url: 'https://fallback.fr',
        label: 'fallback.fr',
      });
    });

    it('renvoie null si aucune source', () => {
      expect(resolveSiteWeb(null, null)).toBeNull();
      expect(resolveSiteWeb('', '')).toBeNull();
    });
  });

  describe('formatLocalisation', () => {
    it('compose "CP VILLE (dept)"', () => {
      expect(formatLocalisation('31', 'MONTREJEAU', '31210')).toBe(
        '31210 MONTREJEAU (31)',
      );
    });

    it('gère les champs partiels', () => {
      expect(formatLocalisation('31', null, null)).toBe('(31)');
      expect(formatLocalisation(null, 'PARIS', null)).toBe('PARIS');
      expect(formatLocalisation(null, null, null)).toBeNull();
    });
  });
});
