import { describe, expect, it } from 'vitest';
import { SERVICE_CONTRACTS, SERVICE_CONTRACT_PREP_SECONDS, SERVICE_CONTRACT_RESULT_LIMIT,
  SERVICE_CONTRACT_RULES_VERSION, SERVICE_CONTRACTS_V6, getServiceContractTemplate } from './serviceContracts';
import v6Evidence from './serviceContractsV6Evidence.json';

describe('service contract catalogue', () => {
  it('offers the evidence-selected v6 contracts without changing the frozen v5 terms', () => {
    expect(SERVICE_CONTRACT_RULES_VERSION).toBe(6);
    expect(SERVICE_CONTRACT_PREP_SECONDS).toBe(900);
    expect(SERVICE_CONTRACT_RESULT_LIMIT).toBe(10);
    expect(SERVICE_CONTRACTS).toBe(SERVICE_CONTRACTS_V6);
    expect(SERVICE_CONTRACTS_V6).toEqual(v6Evidence.selectedOffers.map(({ v6Offer }) => v6Offer));
    const frozen = value => {
      expect(Object.isFrozen(value)).toBe(true);
      Object.values(value).filter(v => v && typeof v === 'object').forEach(frozen);
    };
    frozen(SERVICE_CONTRACTS_V6);
    expect(SERVICE_CONTRACTS_V6.map(({ id, tier }) => [id, tier])).toEqual([
      ['office-lunch', 'introductory'],
      ['family-service', 'standard'],
      ['tasting-service', 'advanced'],
      ['party-rush', 'expert'],
    ]);
    for (const offer of SERVICE_CONTRACTS_V6) {
      expect(getServiceContractTemplate(offer.id, 6)).toBe(offer);
      expect(getServiceContractTemplate(offer.id, 5)).not.toBe(offer);
      expect(getServiceContractTemplate(offer.id, 7)).toBe(null);
      expect(getServiceContractTemplate(offer.id, '6')).toBe(null);
    }
    expect(getServiceContractTemplate('office-lunch')).toBe(SERVICE_CONTRACTS[0]);
    expect(getServiceContractTemplate('toString')).toBe(null);
  });
  it('keeps literal v1-v5 snapshots unchanged', () => {
    const office = {
      id: 'office-lunch', title: 'Office lunch', guestLabel: 'Office guest',
      profile: { archetype: 'rusher', spendingTier: 'value', spendingBudget: 24 },
      parties: [0, 720, 1440].map(arrivalOffset => ({ partyType: 'couple', size: 2, arrivalOffset })),
      serviceDuration: 3600, target: 4, reward: 90,
    };
    const family = {
      id: 'family-service', title: 'Family service', guestLabel: 'Family guest',
      profile: { archetype: 'regular', spendingTier: 'budget', spendingBudget: 18 },
      parties: [0, 1200].map(arrivalOffset => ({ partyType: 'family', size: 4, arrivalOffset })),
      serviceDuration: 4500, target: 6, reward: 120,
    };
    const tasting = {
      id: 'tasting-service', title: 'Tasting service', guestLabel: 'Tasting guest',
      profile: { archetype: 'foodie', spendingTier: 'premium', spendingBudget: 45 },
      parties: [0, 600, 1200, 1800].map(arrivalOffset => ({ partyType: 'solo', size: 1, arrivalOffset })),
      serviceDuration: 4200, target: 3, reward: 100,
    };
    const rush = {
      id: 'party-rush', title: 'Party rush', guestLabel: 'Party guest',
      profile: { archetype: 'regular', spendingTier: 'value', spendingBudget: 30 },
      parties: [0, 0, 120, 120, 240, 240].map(arrivalOffset => ({ partyType: 'couple', size: 2, arrivalOffset })),
      serviceDuration: 6000, target: 6, reward: 180,
    };
    const expected = {
      1: [office, family, tasting],
      2: [
        { ...office, serviceDuration: 4200 },
        { ...family, serviceDuration: 6000 },
        tasting,
      ],
      3: [
        { ...office, serviceDuration: 4200 },
        { ...family, serviceDuration: 6000 },
        tasting,
        rush,
      ],
      4: [
        { ...office, serviceDuration: 5250 },
        { ...family, serviceDuration: 7500 },
        { ...tasting, serviceDuration: 5250 },
        { ...rush, serviceDuration: 7500 },
      ],
      5: [
        { ...office, serviceDuration: 5250,
          profile: { ...office.profile, patienceMultiplier: 1.5 } },
        { ...family, serviceDuration: 7500, target: 4 },
        { ...tasting, serviceDuration: 5250,
          profile: { ...tasting.profile, patienceMultiplier: 1.5 } },
        { ...rush, serviceDuration: 7500,
          parties: [0, 120, 240, 360, 480, 600]
            .map(arrivalOffset => ({ partyType: 'couple', size: 2, arrivalOffset })) },
      ],
    };
    for (const [version, snapshots] of Object.entries(expected)) {
      const actual = ['office-lunch', 'family-service', 'tasting-service', 'party-rush']
        .map(id => getServiceContractTemplate(id, Number(version))).filter(Boolean);
      expect(actual).toEqual(snapshots);
    }
  });
  it('retains exact frozen v1 content and rejects unknown catalogue revisions', () => {
    for (const [id, oldDuration] of [['office-lunch', 3600], ['family-service', 4500], ['tasting-service', 4200]]) {
      const legacy = getServiceContractTemplate(id, 1);
      expect(legacy).toEqual({ ...getServiceContractTemplate(id, 2), serviceDuration: oldDuration });
      expect(Object.isFrozen(legacy)).toBe(true);
      expect(Object.isFrozen(legacy.parties)).toBe(true);
      expect(Object.isFrozen(legacy.profile)).toBe(true);
      expect(getServiceContractTemplate(id, 3)).toEqual(getServiceContractTemplate(id, 2));
      expect(getServiceContractTemplate(id, 4)).toEqual({ ...getServiceContractTemplate(id, 3),
        serviceDuration: getServiceContractTemplate(id, 3).serviceDuration * 1.25 });
      expect(getServiceContractTemplate(id, 7)).toBe(null);
      expect(getServiceContractTemplate(id, '2')).toBe(null);
    }
    expect(getServiceContractTemplate('party-rush', 1)).toBe(null);
    expect(getServiceContractTemplate('party-rush', 2)).toBe(null);
  });
  it.each([['office-lunch', 4200], ['family-service', 6000], ['tasting-service', 4200], ['party-rush', 6000]])(
    'preserves the frozen v3 %s terms and changes only its duration in v4/v5', (id, duration) => {
      const old = getServiceContractTemplate(id, 3);
      expect(old.serviceDuration).toBe(duration);
      expect(Object.isFrozen(old)).toBe(true);
      expect(Object.isFrozen(old.parties)).toBe(true);
      expect(Object.isFrozen(old.profile)).toBe(true);
      const v4 = { ...old, serviceDuration: duration * 1.25 };
      expect(getServiceContractTemplate(id, 4)).toEqual(v4);
      expect(getServiceContractTemplate(id, 5)).toMatchObject({ serviceDuration: v4.serviceDuration });
      if (['office-lunch', 'tasting-service'].includes(id)) {
        expect(getServiceContractTemplate(id, 5)).toEqual({ ...v4,
          profile: { ...v4.profile, patienceMultiplier: 1.5 } });
      }
    });
  it('keeps v4 family/rush snapshots frozen while applying changes only in v5', () => {
    expect(getServiceContractTemplate('office-lunch', 4).profile).not.toHaveProperty('patienceMultiplier');
    expect(getServiceContractTemplate('tasting-service', 4).profile).not.toHaveProperty('patienceMultiplier');
    expect(getServiceContractTemplate('family-service', 4)).toMatchObject({ target: 6, reward: 120,
      serviceDuration: 7500 });
    expect(getServiceContractTemplate('family-service', 5)).toMatchObject({ target: 4, reward: 120,
      serviceDuration: 7500 });
    expect(getServiceContractTemplate('party-rush', 4)).toMatchObject({
      parties: [0, 0, 120, 120, 240, 240].map(arrivalOffset => ({ partyType: 'couple', size: 2, arrivalOffset })),
      target: 6, reward: 180, serviceDuration: 7500,
    });
    expect(getServiceContractTemplate('party-rush', 5)).toMatchObject({
      parties: [0, 120, 240, 360, 480, 600].map(arrivalOffset => ({ partyType: 'couple', size: 2, arrivalOffset })),
      target: 6, reward: 180, serviceDuration: 7500,
    });
    for (const id of ['family-service', 'party-rush']) {
      expect(Object.isFrozen(getServiceContractTemplate(id, 4))).toBe(true);
      expect(Object.isFrozen(getServiceContractTemplate(id, 5))).toBe(true);
      expect(Object.isFrozen(getServiceContractTemplate(id, 5).parties)).toBe(true);
    }
  });
  it('applies only the selected target patch and advisory tier metadata to v5', () => {
    const selectedTargets = {
      'office-lunch': 2,
      'family-service': 4,
      'tasting-service': 2,
      'party-rush': 3,
    };
    for (const { id, target, tier, preparationExpectations } of v6Evidence.selectedOffers.map(
      ({ v6Offer }) => v6Offer)) {
      const v5 = getServiceContractTemplate(id, 5);
      expect(getServiceContractTemplate(id, 6)).toEqual({
        ...v5,
        target: selectedTargets[id],
        tier,
        preparationExpectations,
      });
      expect(target).toBe(selectedTargets[id]);
      expect(Object.isFrozen(getServiceContractTemplate(id, 6).preparationExpectations)).toBe(true);
    }
    expect(v6Evidence.selectedOffers.find(({ templateId }) => templateId === 'family-service').patch)
      .toBe(null);
    expect(v6Evidence.selectedOffers.map(({ templateId }) => templateId)).toEqual([
      'office-lunch', 'family-service', 'tasting-service', 'party-rush',
    ]);
  });
});
