import { describe, expect, it } from 'vitest';
import * as finance from './serviceContractFinance';

describe('contract financial terms', () => {
  it.each([
    ['office-lunch', 22.5, 67.5, 45], ['family-service', 30, 90, 60],
    ['tasting-service', 25, 75, 50], ['party-rush', 45, 135, 90],
  ])('splits %s reward without losing cents', (id, deposit, balance, compensation) => {
    expect(finance.getServiceContractTerms(id, 3)).toEqual({ deposit, balance, compensation, reputationPenalty: 0.25 });
    expect(finance.getServiceContractSettlement({ templateId: id, rulesVersion: 3 }, 'succeeded'))
      .toEqual({ bonusPaid: deposit + balance, cashDelta: balance, depositPaid: deposit,
        depositRefunded: 0, compensationPaid: 0, reputationPenalty: 0 });
    for (const status of ['failed', 'withdrawn']) {
      expect(finance.getServiceContractSettlement({ templateId: id, rulesVersion: 3 }, status))
        .toEqual({ bonusPaid: 0, cashDelta: -(deposit + compensation), depositPaid: deposit,
          depositRefunded: deposit, compensationPaid: compensation, reputationPenalty: 0.25 });
    }
  });
  it.each([1, 2])('preserves revision %s payments without deposits or penalties', rulesVersion => {
    expect(finance.getServiceContractTerms('office-lunch', rulesVersion))
      .toEqual({ deposit: 0, balance: 90, compensation: 0, reputationPenalty: 0 });
    const active = { templateId: 'office-lunch', rulesVersion };
    expect(finance.getServiceContractSettlement(active, 'succeeded')).toMatchObject({ cashDelta: 90, bonusPaid: 90 });
    expect(finance.getServiceContractSettlement(active, 'failed')).toMatchObject({ cashDelta: 0, reputationPenalty: 0 });
  });
  it.each([undefined, null, '3', 0, 4])('does not guess financial revision %s', version => {
    expect(finance.getServiceContractTerms('party-rush', version)).toBeNull();
    expect(() => finance.getServiceContractSettlement({ templateId: 'party-rush', rulesVersion: version }, 'failed')).toThrow();
  });
  it('rejects unknown identities and unsettled statuses', () => {
    expect(finance.getServiceContractTerms('unknown', 3)).toBeNull();
    expect(() => finance.getServiceContractSettlement({ templateId: 'unknown', rulesVersion: 3 }, 'failed')).toThrow();
    expect(() => finance.getServiceContractSettlement({ templateId: 'party-rush', rulesVersion: 3 }, 'preparing')).toThrow();
  });
});
