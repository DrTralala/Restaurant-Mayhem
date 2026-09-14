# Dish Roles and Canvas Polish

**Date:** 2026-09-14

## Status

Approved design.

## Goals

1. Make waiters responsible for collecting and transporting dishes.
2. Keep table wiping and floor cleaning with janitors, and keep dish washing with janitors.
3. Remove background rectangles behind in-world object labels.
4. Remove the bottom-left hover text entirely.
5. Remove the small square hand endpoints from every character pose.

## Staff responsibilities and dish flow

### Role split

- Waiters own dirty-dish logistics:
  - collecting dishes from dirty tables;
  - collecting cancelled or abandoned physical dishes awaiting cleanup;
  - carrying dirty dishes;
  - delivering dishes to manual or automatic wash stations;
  - transferring queued dishes between wash stations when a transfer is required.
- Janitors own:
  - wiping dirty tables;
  - cleaning floor dirt;
  - manual dish washing.
- Automatic dishwashers continue processing queued items without assigning washing work to a waiter.

The role/task boundary must be enforced consistently in task assignment, task execution, service-item ownership normalisation, carrying validation, station reservations, and task recovery. Waiters must not be assigned `wash_item`, `clean_table`, or `clean_floor`; janitors must not be assigned dirty-dish collection or transport tasks.

### State flow

Ordinary and cancelled/abandoned physical dishes follow one logistics path:

```text
dirty_at_table / uncollected to_clean
  -> waiter collects
  -> carried_dirty
  -> waiter delivers or transfers
  -> queued_for_wash
  -> janitor washes manually or an automatic dishwasher processes the item
```

`to_clean` remains an uncollected physical-dish state, rather than a direct janitor-disposal action. A waiter pickup target may be either a table or the item's current position. The item's waste origin and relevant table/service-station metadata remain intact while it is collected and queued.

Cancelled food already carried by a waiter becomes a normal `carried_dirty` load and uses the ordinary waiter delivery route. Cancelled food held by a cook is released at its current position for waiter pickup instead of being transported directly by the cook. The direct cancelled-waste handoff and direct `clean_service_item` disposal paths are retired from new task assignment.

If a wash station is unavailable or full, the item and its ownership claim remain recoverable and are retried later; no dish is silently removed. Invalid current runtime assignments are released or re-queued according to the item's physical state. Legacy-save migration is explicitly out of scope, and existing saves may be invalidated or removed if the state model requires it.

## Canvas presentation

### Object labels

`drawObjectLabel` remains responsible for centred text, wrapping, font, and contrast colour, but no longer draws a background rectangle. The change applies to all normal furniture/equipment labels and placement previews, including the cashier preview. No replacement background, outline, or new label content is introduced.

### Hover text

The bottom-left hover overlay is removed completely. No cursor tooltip replaces it. Click hit-testing, staff selection, fixture context menus, and placement interactions remain unchanged.

### Character hands

`drawStickFigure` stops drawing both 2x2 hand endpoint squares for every pose: walking, stationary, seated, lying, and cleaning. The arm strokes and the existing cleaning/mop line remain unchanged.

## Affected areas

- `src/simulation/taskRoles.js`: update the role/task matrix.
- `src/simulation/staff.js`: split waiter dish logistics from janitor cleaning/washing, update candidate selection, carrying routes, station transfers, completion checks, and runtime recovery.
- `src/simulation/serviceItems.js`, `src/simulation/foodPatience.js`, and `src/simulation/sinkTransfers.js`: align carrying, cancellation, queue, and transfer ownership with the new split.
- `src/simulation/staffTaskLifecycle.js` and related cleaning helpers: retain janitor-only washing/table/floor progress and release behaviour while removing obsolete direct dish disposal assignment.
- `src/canvas/layers.js`: remove label backgrounds, hover overlay drawing, and hand endpoint squares.
- `src/canvas/RestaurantCanvas.jsx`: remove hover-tooltip state and updates while preserving click interactions.
- Relevant simulation and canvas tests: replace obsolete janitor-collection, black-background, bottom-left-overlay, and hand-square expectations with the new behaviour.

## Verification

Focused tests will cover:

- waiter collection, carrying, delivery, and inter-station transfer of ordinary dishes;
- waiter handling of cancelled and abandoned dishes;
- janitor manual washing and table/floor cleaning;
- automatic dishwasher processing;
- station capacity, duplicate ownership, stale tasks, and current-runtime recovery;
- text labels rendered without background fills;
- absence of the hover overlay;
- absence of hand endpoint fills in every pose;
- unchanged click selection and context-menu behaviour.

The implementation will then run `npm test` and `npm run build`.

## Out of scope

- Adding a new hover tooltip or changing its position.
- Redesigning label wording, fonts, colours, or object placement.
- Moving table wiping or floor cleaning away from janitors.
- Preserving or migrating legacy save data.
