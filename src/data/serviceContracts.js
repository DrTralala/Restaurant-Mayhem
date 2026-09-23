export const SERVICE_CONTRACT_RULES_VERSION = 3;
export const SERVICE_CONTRACT_PREP_SECONDS = 900;
export const SERVICE_CONTRACT_RESULT_LIMIT = 10;

function freezeTemplate(template) {
  return Object.freeze({ ...template, profile: Object.freeze(template.profile),
    parties: Object.freeze(template.parties.map(party => Object.freeze(party))) });
}

// These v1 snapshots are also the save-validation authority. Balance revisions
// must introduce new rules rather than changing the content of existing saves.
const SERVICE_CONTRACTS_V1 = Object.freeze([
  { id: 'office-lunch', title: 'Office lunch', guestLabel: 'Office guest',
    profile: { archetype: 'rusher', spendingTier: 'value', spendingBudget: 24 },
    parties: [0, 720, 1440].map(arrivalOffset => ({ partyType: 'couple', size: 2, arrivalOffset })),
    serviceDuration: 3600, target: 4, reward: 90 },
  { id: 'family-service', title: 'Family service', guestLabel: 'Family guest',
    profile: { archetype: 'regular', spendingTier: 'budget', spendingBudget: 18 },
    parties: [0, 1200].map(arrivalOffset => ({ partyType: 'family', size: 4, arrivalOffset })),
    serviceDuration: 4500, target: 6, reward: 120 },
  { id: 'tasting-service', title: 'Tasting service', guestLabel: 'Tasting guest',
    profile: { archetype: 'foodie', spendingTier: 'premium', spendingBudget: 45 },
    parties: [0, 600, 1200, 1800].map(arrivalOffset => ({ partyType: 'solo', size: 1, arrivalOffset })),
    serviceDuration: 4200, target: 3, reward: 100 },
].map(freezeTemplate));

// V2 changes only new offers' service windows. Never overwrite v1 definitions:
// accepted rosters and historical results still validate against those rules.
const SERVICE_CONTRACTS_V2 = Object.freeze(SERVICE_CONTRACTS_V1.map(template => freezeTemplate({
  ...template,
  serviceDuration: template.id === 'office-lunch' ? 4200
    : template.id === 'family-service' ? 6000 : template.serviceDuration,
})));

// V3 adds financial stakes and Party rush without rewriting accepted v1/v2 terms.
export const SERVICE_CONTRACTS = Object.freeze([
  ...SERVICE_CONTRACTS_V2,
  freezeTemplate({ id: 'party-rush', title: 'Party rush', guestLabel: 'Party guest',
    profile: { archetype: 'regular', spendingTier: 'value', spendingBudget: 30 },
    parties: [0, 0, 120, 120, 240, 240].map(arrivalOffset => ({ partyType: 'couple', size: 2, arrivalOffset })),
    serviceDuration: 6000, target: 6, reward: 180 }),
]);

export function getServiceContractTemplate(templateId, rulesVersion = SERVICE_CONTRACT_RULES_VERSION) {
  const catalogue = rulesVersion === 1 ? SERVICE_CONTRACTS_V1
    : rulesVersion === 2 ? SERVICE_CONTRACTS_V2 : rulesVersion === 3 ? SERVICE_CONTRACTS : null;
  return catalogue?.find(template => template.id === templateId) || null;
}
