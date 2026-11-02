// Revision-aware terms shared by settlement, validation and presentation.
import { getServiceContractTemplate } from '../data/serviceContracts';

const money = value => Math.round(value * 100) / 100;

export function getServiceContractTerms(templateId, rulesVersion) {
  if (![1, 2, 3, 4, 5, 6].includes(rulesVersion)) return null;
  const template = getServiceContractTemplate(templateId, rulesVersion);
  if (!template) return null;
  const deposit = rulesVersion >= 3 ? money(template.reward * 0.25) : 0;
  const compensation = rulesVersion >= 5 ? money(template.reward * 0.25)
    : rulesVersion >= 3 ? money(template.reward * 0.5) : 0;
  return { deposit, balance: money(template.reward - deposit),
    compensation,
    reputationPenalty: rulesVersion >= 3 ? 0.25 : 0 };
}

export function getServiceContractSettlement(instance, status, settledAt) {
  const terms = getServiceContractTerms(instance.templateId, instance.rulesVersion);
  if (!terms || !['succeeded', 'failed', 'withdrawn'].includes(status)) {
    throw new Error('Invalid contract settlement');
  }
  if (instance.rulesVersion >= 5 && (!Number.isFinite(settledAt) || settledAt < 0
    || !Number.isFinite(instance.serviceStartAt) || instance.serviceStartAt < 0)) {
    throw new Error('Invalid contract settlement time');
  }
  const success = status === 'succeeded';
  const preparationWithdrawal = instance.rulesVersion >= 5 && status === 'withdrawn'
    && settledAt < instance.serviceStartAt;
  const compensationPaid = success || preparationWithdrawal ? 0 : terms.compensation;
  return { bonusPaid: success ? money(terms.deposit + terms.balance) : 0,
    cashDelta: success ? terms.balance : preparationWithdrawal ? money(0 - terms.deposit)
      : money(0 - terms.deposit - terms.compensation),
    depositPaid: terms.deposit, depositRefunded: success ? 0 : terms.deposit,
    compensationPaid,
    reputationPenalty: success || preparationWithdrawal ? 0 : terms.reputationPenalty };
}
