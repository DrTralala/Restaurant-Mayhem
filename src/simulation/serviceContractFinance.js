// Revision-aware terms shared by settlement, validation and presentation.
import { getServiceContractTemplate } from '../data/serviceContracts';

const money = value => Math.round(value * 100) / 100;

export function getServiceContractTerms(templateId, rulesVersion) {
  if (![1, 2, 3].includes(rulesVersion)) return null;
  const template = getServiceContractTemplate(templateId, rulesVersion);
  if (!template) return null;
  const deposit = rulesVersion === 3 ? money(template.reward * 0.25) : 0;
  return { deposit, balance: money(template.reward - deposit),
    compensation: rulesVersion === 3 ? money(template.reward * 0.5) : 0,
    reputationPenalty: rulesVersion === 3 ? 0.25 : 0 };
}

export function getServiceContractSettlement(instance, status) {
  const terms = getServiceContractTerms(instance.templateId, instance.rulesVersion);
  if (!terms || !['succeeded', 'failed', 'withdrawn'].includes(status)) {
    throw new Error('Invalid contract settlement');
  }
  const success = status === 'succeeded';
  return { bonusPaid: success ? money(terms.deposit + terms.balance) : 0,
    cashDelta: success ? terms.balance : money(0 - terms.deposit - terms.compensation),
    depositPaid: terms.deposit, depositRefunded: success ? 0 : terms.deposit,
    compensationPaid: success ? 0 : terms.compensation,
    reputationPenalty: success ? 0 : terms.reputationPenalty };
}
