# Restaurant Mayhem

Restaurant Mayhem is a browser-based restaurant management simulation. Build and rearrange your restaurant, manage staff and menus, and watch customers move through seating, ordering, dining and checkout.

## Quick start

### Requirements

- Node.js and npm (development checks have been run with Node.js 24 and npm 11)
- A modern browser

### Install and run

```sh
git clone https://github.com/DrTralala/Restaurant-Mayhem.git
cd Restaurant-Mayhem
npm ci
npm run dev
```

Open the local URL printed by Vite. Keep the development server local: its save API is intended for trusted local use and has no authentication.

## What you can manage

- **Restaurant layout**: place, move and copy fixtures, arrange seating and equipment, and configure entrances and exits.
- **Staff**: manage roles, training and progression, with skills affecting work and carrying capacity.
- **Food and drink**: configure the menu and manage kitchen equipment and cooking batches.
- **Customer flow**: handle queues, self-seating, service, checkout and table turnover.
- **Business progression**: track funds, reputation, statistics and milestones, buy upgrades, and set operating hours.

Use the management book for upgrades, items, staff, milestones, statistics and hours. The menu control opens menu management; Settings provides save, load and new-game actions.

Pause or resume with the pause control or **Space** when not interacting with a form control. Choose **1x**, **2x** or **4x** simulation speed, and use **Fit** to frame the restaurant.

## Saves

- Automatic saves use the browser's local storage. They belong to that browser profile and site origin; clearing site data removes them.
- **Settings → Save game** writes a JSON snapshot into the checkout's `saves/` directory through the Vite development server.
- **Settings → Load game** loads the most recently modified JSON save from that directory. Incompatible save versions are rejected.
- `saves/` is excluded from Git. Back up any saves you want to keep separately.

The file-based save API is available with `npm run dev`, not with a static deployment or `npm run preview`. Browser-local saving remains separate from these file-based actions.

## Development checks

```sh
# Run the test suite
npm test

# Watch tests while developing
npm run test:watch

# Build the browser application
npm run build

# Preview the production build locally
npm run preview
```

The production build is written to `dist/`, which is generated locally and excluded from Git. The application uses Vitest, jsdom and React Testing Library for tests.

## Project structure

| Path | Responsibility |
|---|---|
| `src/canvas/` | Restaurant rendering and spatial interaction |
| `src/components/`, `src/panels/` | Game controls and management interfaces |
| `src/data/` | Menu, equipment, placeable items and progression data |
| `src/simulation/` | Customer flow, staff tasks, cooking, movement and business simulation |
| `src/state/` | Game state, simulation runtime, persistence and save recovery |
| `scripts/` | Development and performance-analysis utilities |
| `devSavePlugin.js` | Local development-server save API |

## Technology

- React 18 and JavaScript modules
- Vite 6
- Vitest 2, jsdom and React Testing Library
