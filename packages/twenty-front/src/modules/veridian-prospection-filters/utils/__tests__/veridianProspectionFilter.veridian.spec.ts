import {
  VERIDIAN_SCORE_PRESETS,
  VERIDIAN_SIZE_PRESETS,
  buildGeoFilterId,
  buildIcpFilterId,
  buildScoreMinFilterId,
  buildSiteFilterId,
  buildSizeMaxFilterId,
  buildSizeMinFilterId,
  isVeridianProspectionFilterObject,
  resolveActiveGeoValue,
  resolveActiveIcpValue,
  resolveActiveScorePresetKey,
  resolveActiveSizePresetKey,
  resolveActiveSiteValue,
} from '../veridianProspectionFilter';

describe('veridianProspectionFilter', () => {
  const fieldId = 'field-effectifs-123';
  const siteFieldId = 'field-hasWebsite-456';
  const geoFieldId = 'field-departement-789';
  const scoreFieldId = 'field-prospectScore-abc';
  const icpFieldId = 'field-idealCustomerProfile-def';

  describe('isVeridianProspectionFilterObject', () => {
    it('ne matche QUE company', () => {
      expect(isVeridianProspectionFilterObject('company')).toBe(true);
      expect(isVeridianProspectionFilterObject('person')).toBe(false);
      expect(isVeridianProspectionFilterObject('opportunity')).toBe(false);
      expect(isVeridianProspectionFilterObject(undefined)).toBe(false);
      expect(isVeridianProspectionFilterObject('companies')).toBe(false);
    });
  });

  describe('ids stables déterministes', () => {
    it('sont stables pour un même fieldMetadataId (toggle, pas empilement)', () => {
      expect(buildSizeMinFilterId(fieldId)).toBe(buildSizeMinFilterId(fieldId));
      expect(buildSizeMaxFilterId(fieldId)).toBe(buildSizeMaxFilterId(fieldId));
      expect(buildSiteFilterId(siteFieldId)).toBe(
        buildSiteFilterId(siteFieldId),
      );
    });

    it('min et max ont des ids distincts', () => {
      expect(buildSizeMinFilterId(fieldId)).not.toBe(
        buildSizeMaxFilterId(fieldId),
      );
    });
  });

  describe('presets de taille', () => {
    it('individuel = borne haute seule (<=2)', () => {
      const preset = VERIDIAN_SIZE_PRESETS.find((p) => p.key === 'individuel');
      expect(preset?.min).toBeUndefined();
      expect(preset?.max).toBe(2);
    });

    it('pme = range 3-249', () => {
      const preset = VERIDIAN_SIZE_PRESETS.find((p) => p.key === 'pme');
      expect(preset?.min).toBe(3);
      expect(preset?.max).toBe(249);
    });

    it('grande = borne basse seule (>=250)', () => {
      const preset = VERIDIAN_SIZE_PRESETS.find((p) => p.key === 'grande');
      expect(preset?.min).toBe(250);
      expect(preset?.max).toBeUndefined();
    });
  });

  describe('resolveActiveSizePresetKey', () => {
    it('retrouve PME depuis les deux bornes posées', () => {
      const filters = [
        { id: buildSizeMinFilterId(fieldId), value: '3' },
        { id: buildSizeMaxFilterId(fieldId), value: '249' },
      ];
      expect(resolveActiveSizePresetKey(filters, fieldId)).toBe('pme');
    });

    it('retrouve Individuel depuis la seule borne haute', () => {
      const filters = [{ id: buildSizeMaxFilterId(fieldId), value: '2' }];
      expect(resolveActiveSizePresetKey(filters, fieldId)).toBe('individuel');
    });

    it('retrouve Grande depuis la seule borne basse', () => {
      const filters = [{ id: buildSizeMinFilterId(fieldId), value: '250' }];
      expect(resolveActiveSizePresetKey(filters, fieldId)).toBe('grande');
    });

    it('retourne undefined si aucun preset ne matche exactement', () => {
      const filters = [{ id: buildSizeMinFilterId(fieldId), value: '10' }];
      expect(resolveActiveSizePresetKey(filters, fieldId)).toBeUndefined();
    });

    it('ignore les filtres d’un autre champ', () => {
      const filters = [
        { id: buildSizeMinFilterId('autre-field'), value: '3' },
        { id: buildSizeMaxFilterId('autre-field'), value: '249' },
      ];
      expect(resolveActiveSizePresetKey(filters, fieldId)).toBeUndefined();
    });
  });

  describe('resolveActiveSiteValue', () => {
    it('retourne true / false selon le filtre site posé', () => {
      expect(
        resolveActiveSiteValue(
          [{ id: buildSiteFilterId(siteFieldId), value: 'true' }],
          siteFieldId,
        ),
      ).toBe('true');
      expect(
        resolveActiveSiteValue(
          [{ id: buildSiteFilterId(siteFieldId), value: 'false' }],
          siteFieldId,
        ),
      ).toBe('false');
    });

    it('retourne undefined si aucun filtre site', () => {
      expect(resolveActiveSiteValue([], siteFieldId)).toBeUndefined();
    });
  });

  describe('ids stables (geo / score / icp)', () => {
    it('sont déterministes par fieldMetadataId', () => {
      expect(buildGeoFilterId(geoFieldId)).toBe(buildGeoFilterId(geoFieldId));
      expect(buildScoreMinFilterId(scoreFieldId)).toBe(
        buildScoreMinFilterId(scoreFieldId),
      );
      expect(buildIcpFilterId(icpFieldId)).toBe(buildIcpFilterId(icpFieldId));
    });
  });

  describe('presets de qualité (score)', () => {
    it('top ≥90, bon ≥70, moyen ≥50', () => {
      expect(VERIDIAN_SCORE_PRESETS.find((p) => p.key === 'top')?.min).toBe(90);
      expect(VERIDIAN_SCORE_PRESETS.find((p) => p.key === 'bon')?.min).toBe(70);
      expect(VERIDIAN_SCORE_PRESETS.find((p) => p.key === 'moyen')?.min).toBe(
        50,
      );
    });
  });

  describe('resolveActiveScorePresetKey', () => {
    it('retrouve le preset depuis la borne posée', () => {
      const filters = [
        { id: buildScoreMinFilterId(scoreFieldId), value: '90' },
      ];
      expect(resolveActiveScorePresetKey(filters, scoreFieldId)).toBe('top');
    });

    it('undefined si aucun preset ne matche exactement', () => {
      const filters = [
        { id: buildScoreMinFilterId(scoreFieldId), value: '42' },
      ];
      expect(resolveActiveScorePresetKey(filters, scoreFieldId)).toBeUndefined();
    });

    it('undefined si aucun filtre score', () => {
      expect(resolveActiveScorePresetKey([], scoreFieldId)).toBeUndefined();
    });
  });

  describe('resolveActiveGeoValue', () => {
    it('retourne la valeur du département posée', () => {
      const filters = [{ id: buildGeoFilterId(geoFieldId), value: '75' }];
      expect(resolveActiveGeoValue(filters, geoFieldId)).toBe('75');
    });

    it('trim et traite une valeur vide comme absente', () => {
      const filters = [{ id: buildGeoFilterId(geoFieldId), value: '  ' }];
      expect(resolveActiveGeoValue(filters, geoFieldId)).toBeUndefined();
    });

    it('undefined si aucun filtre geo', () => {
      expect(resolveActiveGeoValue([], geoFieldId)).toBeUndefined();
    });
  });

  describe('resolveActiveIcpValue', () => {
    it('true seulement si le filtre ICP vaut "true"', () => {
      expect(
        resolveActiveIcpValue(
          [{ id: buildIcpFilterId(icpFieldId), value: 'true' }],
          icpFieldId,
        ),
      ).toBe(true);
      expect(
        resolveActiveIcpValue(
          [{ id: buildIcpFilterId(icpFieldId), value: 'false' }],
          icpFieldId,
        ),
      ).toBe(false);
      expect(resolveActiveIcpValue([], icpFieldId)).toBe(false);
    });
  });
});
