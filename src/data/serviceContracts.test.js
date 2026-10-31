import { describe, expect, it } from 'vitest';
import { SERVICE_CONTRACTS, SERVICE_CONTRACT_PREP_SECONDS, SERVICE_CONTRACT_RESULT_LIMIT,
  SERVICE_CONTRACT_RULES_VERSION, getServiceContractTemplate } from './serviceContracts';

describe('service contract catalogue', () => {
  it('offers 25% longer service windows with unchanged preparation and terms, deeply frozen', () => {
    expect(SERVICE_CONTRACT_RULES_VERSION).toBe(4);
    expect(SERVICE_CONTRACT_PREP_SECONDS).toBe(900);
    expect(SERVICE_CONTRACT_RESULT_LIMIT).toBe(10);
    expect(SERVICE_CONTRACTS).toEqual([
      { id: 'office-lunch', title: 'Office lunch', guestLabel: 'Office guest',
        profile: { archetype: 'rusher', spendingTier: 'value', spendingBudget: 24 },
        parties: [0, 720, 1440].map(arrivalOffset => ({ partyType: 'couple', size: 2, arrivalOffset })),
        serviceDuration: 5250, target: 4, reward: 90 },
      { id: 'family-service', title: 'Family service', guestLabel: 'Family guest',
        profile: { archetype: 'regular', spendingTier: 'budget', spendingBudget: 18 },
        parties: [0, 1200].map(arrivalOffset => ({ partyType: 'family', size: 4, arrivalOffset })),
        serviceDuration: 7500, target: 6, reward: 120 },
      { id: 'tasting-service', title: 'Tasting service', guestLabel: 'Tasting guest',
        profile: { archetype: 'foodie', spendingTier: 'premium', spendingBudget: 45 },
        parties: [0, 600, 1200, 1800].map(arrivalOffset => ({ partyType: 'solo', size: 1, arrivalOffset })),
        serviceDuration: 5250, target: 3, reward: 100 },
      { id: 'party-rush', title: 'Party rush', guestLabel: 'Party guest',
        profile: { archetype: 'regular', spendingTier: 'value', spendingBudget: 30 },
        parties: [0, 0, 120, 120, 240, 240].map(arrivalOffset => ({ partyType: 'couple', size: 2, arrivalOffset })),
        serviceDuration: 7500, target: 6, reward: 180 },
    ]);
    const frozen = value => {
      expect(Object.isFrozen(value)).toBe(true);
      Object.values(value).filter(v => v && typeof v === 'object').forEach(frozen);
    };
    frozen(SERVICE_CONTRACTS);
    expect(getServiceContractTemplate('office-lunch')).toBe(SERVICE_CONTRACTS[0]);
    expect(getServiceContractTemplate('toString')).toBe(null);
  });
  it('retains exact frozen v1 content and rejects unknown catalogue revisions', () => {
    for (const [id, oldDuration] of [['office-lunch', 3600], ['family-service', 4500], ['tasting-service', 4200]]) {
      const legacy = getServiceContractTemplate(id, 1);
      expect(legacy).toEqual({ ...getServiceContractTemplate(id, 2), serviceDuration: oldDuration });
      expect(Object.isFrozen(legacy)).toBe(true);
      expect(Object.isFrozen(legacy.parties)).toBe(true);
      expect(Object.isFrozen(legacy.profile)).toBe(true);
      expect(getServiceContractTemplate(id, 3)).toEqual(getServiceContractTemplate(id, 2));
      expect(getServiceContractTemplate(id, 5)).toBe(null);
      expect(getServiceContractTemplate(id, '2')).toBe(null);
    }
    expect(getServiceContractTemplate('party-rush', 1)).toBe(null);
    expect(getServiceContractTemplate('party-rush', 2)).toBe(null);
  });
  it.each([['office-lunch', 4200], ['family-service', 6000], ['tasting-service', 4200], ['party-rush', 6000]])(
    'preserves the frozen v3 %s terms and changes only its duration in v4', (id, duration) => {
      const old = getServiceContractTemplate(id, 3);
      expect(old.serviceDuration).toBe(duration);
      expect(Object.isFrozen(old)).toBe(true);
      expect(Object.isFrozen(old.parties)).toBe(true);
      expect(Object.isFrozen(old.profile)).toBe(true);
      expect(getServiceContractTemplate(id, 4)).toEqual({ ...old, serviceDuration: duration * 1.25 });
    });
});
