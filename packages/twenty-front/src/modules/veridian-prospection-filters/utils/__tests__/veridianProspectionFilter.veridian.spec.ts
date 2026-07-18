import {
  DEPARTMENT_BY_CODE,
  FRENCH_REGIONS,
  formatDeptLabel,
  normalizeDeptCode,
} from '../frenchDepartments';
import {
  VERIDIAN_SCORE_PRESETS,
  VERIDIAN_SIZE_PRESETS,
  buildGeoDeptFilterId,
  buildGeoGroupId,
  buildIcpFilterId,
  buildMobileFilterId,
  buildScoreMinFilterId,
  buildSiteFilterId,
  buildSizeMaxFilterId,
  buildSizeMinFilterId,
  isVeridianProspectionFilterObject,
  resolveActiveGeoCodes,
  resolveActiveIcpValue,
  resolveActiveMobileValue,
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
  const mobileFieldId = 'field-hasMobile-ghi';

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

  describe('ids stables (geo / score / icp / mobile)', () => {
    it('sont déterministes par fieldMetadataId', () => {
      expect(buildGeoGroupId(geoFieldId)).toBe(buildGeoGroupId(geoFieldId));
      expect(buildGeoDeptFilterId(geoFieldId, '31')).toBe(
        buildGeoDeptFilterId(geoFieldId, '31'),
      );
      expect(buildScoreMinFilterId(scoreFieldId)).toBe(
        buildScoreMinFilterId(scoreFieldId),
      );
      expect(buildIcpFilterId(icpFieldId)).toBe(buildIcpFilterId(icpFieldId));
      expect(buildMobileFilterId(mobileFieldId)).toBe(
        buildMobileFilterId(mobileFieldId),
      );
    });

    it('un id de dépt diffère par code', () => {
      expect(buildGeoDeptFilterId(geoFieldId, '31')).not.toBe(
        buildGeoDeptFilterId(geoFieldId, '32'),
      );
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

  describe('resolveActiveGeoCodes (multi-département)', () => {
    it('extrait les codes des filtres geo-dept du champ', () => {
      const filters = [
        { id: buildGeoDeptFilterId(geoFieldId, '31'), value: '31' },
        { id: buildGeoDeptFilterId(geoFieldId, '2A'), value: '2A' },
        { id: buildGeoDeptFilterId(geoFieldId, '971'), value: '971' },
      ];
      expect(resolveActiveGeoCodes(filters, geoFieldId)).toEqual([
        '31',
        '2A',
        '971',
      ]);
    });

    it('ignore les filtres d’un autre champ ou hors geo', () => {
      const filters = [
        { id: buildGeoDeptFilterId('autre-field', '31'), value: '31' },
        { id: buildSiteFilterId(siteFieldId), value: 'true' },
      ];
      expect(resolveActiveGeoCodes(filters, geoFieldId)).toEqual([]);
    });

    it('[] si aucun filtre geo', () => {
      expect(resolveActiveGeoCodes([], geoFieldId)).toEqual([]);
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

  describe('resolveActiveMobileValue', () => {
    it('true seulement si le filtre Mobile vaut "true"', () => {
      expect(
        resolveActiveMobileValue(
          [{ id: buildMobileFilterId(mobileFieldId), value: 'true' }],
          mobileFieldId,
        ),
      ).toBe(true);
      expect(
        resolveActiveMobileValue(
          [{ id: buildMobileFilterId(mobileFieldId), value: 'false' }],
          mobileFieldId,
        ),
      ).toBe(false);
      expect(resolveActiveMobileValue([], mobileFieldId)).toBe(false);
    });
  });
});

describe('frenchDepartments', () => {
  it('normalizeDeptCode trim + uppercase (Corse)', () => {
    expect(normalizeDeptCode('  2a ')).toBe('2A');
    expect(normalizeDeptCode(' 75 ')).toBe('75');
    expect(normalizeDeptCode('')).toBe('');
  });

  it('formatDeptLabel connu vs inconnu', () => {
    expect(formatDeptLabel('31')).toBe('31 · Haute-Garonne');
    expect(formatDeptLabel('99')).toBe('99');
  });

  it('aucun code de département en double sur toutes les régions', () => {
    const codes = FRENCH_REGIONS.flatMap((region) =>
      region.departments.map((dept) => dept.code),
    );
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("l'index code→département couvre tous les départements", () => {
    const codes = FRENCH_REGIONS.flatMap((region) =>
      region.departments.map((dept) => dept.code),
    );
    codes.forEach((code) => {
      expect(DEPARTMENT_BY_CODE[code]).toBeDefined();
    });
  });

  it('inclut la Corse (2A/2B) et les DOM (97x)', () => {
    expect(DEPARTMENT_BY_CODE['2A']).toBeDefined();
    expect(DEPARTMENT_BY_CODE['2B']).toBeDefined();
    expect(DEPARTMENT_BY_CODE['971']).toBeDefined();
    expect(DEPARTMENT_BY_CODE['976']).toBeDefined();
  });
});
