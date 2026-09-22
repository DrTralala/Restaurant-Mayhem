export const OPENING_WEEK_SCENARIO = Object.freeze({
  id: 'opening-week',
  revision: 1,
  title: 'Opening Week',
  startAt: 36000,
  durationSeconds: 604800,
  targets: Object.freeze({ paidMeals: 80, reputation: 2 }),
});

export function getCareerScenario(scenarioId, revision = 1) {
  return scenarioId === OPENING_WEEK_SCENARIO.id && revision === OPENING_WEEK_SCENARIO.revision
    ? OPENING_WEEK_SCENARIO : null;
}
