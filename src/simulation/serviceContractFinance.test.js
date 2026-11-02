import { describe, expect, it } from 'vitest';
import * as finance from './serviceContractFinance';

describe.each([3, 4])('contract financial terms v%s', rulesVersion => {
  it.each([
    ['office-lunch', 22.5, 67.5, 45], ['family-service', 30, 90, 60],
    ['tasting-service', 25, 75, 50], ['party-rush', 45, 135, 90],
  ])('splits %s reward without losing cents', (id, deposit, balance, compensation) => {
    expect(finance.getServiceContractTerms(id, rulesVersion)).toEqual({ deposit, balance, compensation, reputationPenalty: 0.25 });
    expect(finance.getServiceContractSettlement({ templateId: id, rulesVersion }, 'succeeded'))
      .toEqual({ bonusPaid: deposit + balance, cashDelta: balance, depositPaid: deposit,
        depositRefunded: 0, compensationPaid: 0, reputationPenalty: 0 });
    for (const status of ['failed', 'withdrawn']) {
      expect(finance.getServiceContractSettlement({ templateId: id, rulesVersion }, status))
        .toEqual({ bonusPaid: 0, cashDelta: -(deposit + compensation), depositPaid: deposit,
          depositRefunded: deposit, compensationPaid: compensation, reputationPenalty: 0.25 });
    }
  });
});

describe('contract financial terms v5', () => {
  it.each([
    ['office-lunch', 22.5, 67.5, 22.5], ['family-service', 30, 90, 30],
    ['tasting-service', 25, 75, 25], ['party-rush', 45, 135, 45],
  ])('keeps %s deposit and reward but lowers post-start compensation', (id, deposit, balance, compensation) => {
    const instance = { templateId: id, rulesVersion: 5, serviceStartAt: 36900 };
    expect(finance.getServiceContractTerms(id, 5))
      .toEqual({ deposit, balance, compensation, reputationPenalty: 0.25 });
    expect(finance.getServiceContractSettlement(instance, 'succeeded', 40000))
      .toEqual({ bonusPaid: deposit + balance, cashDelta: balance, depositPaid: deposit,
        depositRefunded: 0, compensationPaid: 0, reputationPenalty: 0 });
    expect(finance.getServiceContractSettlement(instance, 'failed', 42150))
      .toEqual({ bonusPaid: 0, cashDelta: -(deposit + compensation), depositPaid: deposit,
        depositRefunded: deposit, compensationPaid: compensation, reputationPenalty: 0.25 });
  });

  it('refunds only the deposit for a withdrawal before service and switches at the exact start', () => {
    const instance = { templateId: 'party-rush', rulesVersion: 5, serviceStartAt: 36900 };
    expect(finance.getServiceContractSettlement(instance, 'withdrawn', 36899.999))
      .toEqual({ bonusPaid: 0, cashDelta: -45, depositPaid: 45, depositRefunded: 45,
        compensationPaid: 0, reputationPenalty: 0 });
    expect(finance.getServiceContractSettlement(instance, 'withdrawn', 36900))
      .toEqual({ bonusPaid: 0, cashDelta: -90, depositPaid: 45, depositRefunded: 45,
        compensationPaid: 45, reputationPenalty: 0.25 });
    expect(() => finance.getServiceContractSettlement(instance, 'withdrawn')).toThrow();
  });
});

describe('contract financial terms v6', () => {
  it.each([
    ['office-lunch', 22.5, 67.5, 22.5], ['family-service', 30, 90, 30],
    ['tasting-service', 25, 75, 25], ['party-rush', 45, 135, 45],
  ])('keeps %s financial terms identical to v5', (id, deposit, balance, compensation) => {
    const instance = { templateId: id, rulesVersion: 6, serviceStartAt: 36900 };
    expect(finance.getServiceContractTerms(id, 6)).toEqual(finance.getServiceContractTerms(id, 5));
    expect(finance.getServiceContractTerms(id, 6))
      .toEqual({ deposit, balance, compensation, reputationPenalty: 0.25 });
    expect(finance.getServiceContractSettlement(instance, 'succeeded', 40000))
      .toEqual({ bonusPaid: deposit + balance, cashDelta: balance, depositPaid: deposit,
        depositRefunded: 0, compensationPaid: 0, reputationPenalty: 0 });
    expect(finance.getServiceContractSettlement(instance, 'failed', 42150))
      .toEqual({ bonusPaid: 0, cashDelta: -(deposit + compensation), depositPaid: deposit,
        depositRefunded: deposit, compensationPaid: compensation, reputationPenalty: 0.25 });
  });

  it('uses the exact time boundary for a preparation withdrawal', () => {
    const instance = { templateId: 'party-rush', rulesVersion: 6, serviceStartAt: 36900 };
    expect(finance.getServiceContractSettlement(instance, 'withdrawn', 36899.999))
      .toEqual({ bonusPaid: 0, cashDelta: -45, depositPaid: 45, depositRefunded: 45,
        compensationPaid: 0, reputationPenalty: 0 });
    expect(finance.getServiceContractSettlement(instance, 'withdrawn', 36900))
      .toEqual({ bonusPaid: 0, cashDelta: -90, depositPaid: 45, depositRefunded: 45,
        compensationPaid: 45, reputationPenalty: 0.25 });
  });
});

describe('contract financial revision validation', () => {
  it.each([1, 2])('preserves revision %s payments without deposits or penalties', rulesVersion => {
    expect(finance.getServiceContractTerms('office-lunch', rulesVersion))
      .toEqual({ deposit: 0, balance: 90, compensation: 0, reputationPenalty: 0 });
    const active = { templateId: 'office-lunch', rulesVersion };
    expect(finance.getServiceContractSettlement(active, 'succeeded')).toMatchObject({ cashDelta: 90, bonusPaid: 90 });
    expect(finance.getServiceContractSettlement(active, 'failed')).toMatchObject({ cashDelta: 0, reputationPenalty: 0 });
  });
  it.each([undefined, null, '3', 0, 7])('does not guess financial revision %s', version => {
    expect(finance.getServiceContractTerms('party-rush', version)).toBeNull();
    expect(() => finance.getServiceContractSettlement({ templateId: 'party-rush', rulesVersion: version }, 'failed')).toThrow();
  });
  it('rejects unknown identities and unsettled statuses', () => {
    expect(finance.getServiceContractTerms('unknown', 3)).toBeNull();
    expect(() => finance.getServiceContractSettlement({ templateId: 'unknown', rulesVersion: 3 }, 'failed')).toThrow();
    expect(() => finance.getServiceContractSettlement({ templateId: 'party-rush', rulesVersion: 3 }, 'preparing')).toThrow();
  });
});
