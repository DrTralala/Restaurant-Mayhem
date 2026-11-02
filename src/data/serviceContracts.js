export const SERVICE_CONTRACT_RULES_VERSION = 6;
export const SERVICE_CONTRACT_PREP_SECONDS = 900;
export const SERVICE_CONTRACT_RESULT_LIMIT = 10;

function freezeTemplate(template) {
  return Object.freeze({ ...template, profile: Object.freeze(template.profile),
    parties: Object.freeze(template.parties.map(party => Object.freeze(party))),
    ...(template.preparationExpectations
      ? { preparationExpectations: Object.freeze([...template.preparationExpectations]) } : {}) });
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
const SERVICE_CONTRACTS_V3 = Object.freeze([
  ...SERVICE_CONTRACTS_V2,
  freezeTemplate({ id: 'party-rush', title: 'Party rush', guestLabel: 'Party guest',
    profile: { archetype: 'regular', spendingTier: 'value', spendingBudget: 30 },
    parties: [0, 0, 120, 120, 240, 240].map(arrivalOffset => ({ partyType: 'couple', size: 2, arrivalOffset })),
    serviceDuration: 6000, target: 6, reward: 180 }),
]);

// V4 extends new service windows by 25%; accepted v1–v3 terms stay frozen.
const SERVICE_CONTRACTS_V4 = Object.freeze(SERVICE_CONTRACTS_V3.map(template => freezeTemplate({
  ...template, serviceDuration: template.serviceDuration * 1.25,
})));

// V5 keeps v4 pacing/windows intact, makes Family service attainable after one
// whole family party is missed, spaces Party rush arrivals into a queueable
// ten-minute stream, and lets booked Office/Tasting guests wait longer for service.
// Never rewrite v1–v4 accepted terms or historical results.
const SERVICE_CONTRACTS_V5 = Object.freeze(SERVICE_CONTRACTS_V4.map(template => freezeTemplate({
  ...template,
  ...(template.id === 'office-lunch' || template.id === 'tasting-service'
    ? { profile: { ...template.profile, patienceMultiplier: 1.5 } } : {}),
  ...(template.id === 'family-service' ? { target: 4 } : {}),
  ...(template.id === 'party-rush' ? { parties: [0, 120, 240, 360, 480, 600]
    .map(arrivalOffset => ({ partyType: 'couple', size: 2, arrivalOffset })) } : {}),
})));

// V6 selects only the evidence-frozen target patches and adds advisory tier/setup
// metadata. The per-seed evidence remains test-only in serviceContractsV6Evidence.json.
const SERVICE_CONTRACTS_V6_SELECTIONS = Object.freeze({
  'office-lunch': {
    patch: { target: 2 },
    tier: 'introductory',
    preparationExpectations: [
      'Reference preparation office-starter; actions []; cost 0; starting funds 600; funds before acceptance 600.',
    ],
  },
  'family-service': {
    patch: null,
    tier: 'standard',
    preparationExpectations: [
      'Family-layout reference with two four-chair tables: actions []; cost 0; starting funds 600; funds before acceptance 600.',
    ],
  },
  'tasting-service': {
    patch: { target: 2 },
    tier: 'advanced',
    preparationExpectations: [
      'Move t3 to (200,300), t4 to (360,300), ch5 to (210,280) rotation 2, ch6 to (210,340) rotation 0, ch7 to (180,310) rotation 1, ch8 to (240,310) rotation 3, ch9 to (370,280) rotation 2, ch10 to (370,340) rotation 0, ch11 to (340,310) rotation 1, and ch12 to (400,310) rotation 3; cost 0; starting funds 600; funds before acceptance 600.',
    ],
  },
  'party-rush': {
    patch: { target: 3 },
    tier: 'expert',
    preparationExpectations: [
      'Place chairs at (180,210) rotation 1, (240,210) rotation 3, (340,210) rotation 1, and (400,210) rotation 3; upgrade equipment eq1; cost 300; starting funds 600; funds before acceptance 300.',
    ],
  },
});

export const SERVICE_CONTRACTS_V6 = Object.freeze(SERVICE_CONTRACTS_V5.map(template => {
  const selection = SERVICE_CONTRACTS_V6_SELECTIONS[template.id];
  return freezeTemplate({
    ...template,
    ...(selection.patch || {}),
    tier: selection.tier,
    preparationExpectations: selection.preparationExpectations,
  });
}));

export const SERVICE_CONTRACTS = SERVICE_CONTRACTS_V6;

export function getServiceContractTemplate(templateId, rulesVersion = SERVICE_CONTRACT_RULES_VERSION) {
  const catalogue = rulesVersion === 1 ? SERVICE_CONTRACTS_V1
    : rulesVersion === 2 ? SERVICE_CONTRACTS_V2 : rulesVersion === 3 ? SERVICE_CONTRACTS_V3
      : rulesVersion === 4 ? SERVICE_CONTRACTS_V4
        : rulesVersion === 5 ? SERVICE_CONTRACTS_V5
          : rulesVersion === 6 ? SERVICE_CONTRACTS_V6 : null;
  return catalogue?.find(template => template.id === templateId) || null;
}
