# Restaurant Mayhem

Manage a restaurant in your browser: design the floor, set menus and staffing, and guide customers from arrival through checkout.

There is no published release yet. Run the app from source:

## Quick start

You need Git, Node.js with npm, and a modern browser. The CI workflow uses Node.js 24.

> [!WARNING]
> Keep the Vite development server local. Its repository-save API has no authentication and can read the latest save from, or write a save into, the checkout's `saves/` directory.

```sh
git clone https://github.com/DrTralala/Restaurant-Mayhem.git
cd Restaurant-Mayhem
npm ci
npm run dev
```

Open the local URL printed by Vite. The game starts with a restaurant ready to manage.

## Play

> [!CAUTION]
> Starting Opening Week replaces the current restaurant and its browser autosave. It does not create a backup. To keep a separate copy, use **Settings → Save game** while running the development server before starting the challenge.

- **Design and equip the restaurant:** place and rearrange furniture, seating, entrances, kitchen equipment and service stations.
- **Run the operation:** manage staff, training, assignments, operating hours, menu prices, upgrades, milestones and service contracts.
- **Follow the simulation:** watch customers queue, order, dine and pay; review funds, reputation, statistics and progress as the restaurant runs.

Open the management book for restaurant controls, the menu button to change food and drink, and **Settings** for save, load and new-game actions. Pause or resume with **Space** when focus is not in a form control; choose **1x**, **2x** or **4x** speed, or use **Fit** to frame the restaurant.

To try Opening Week, choose it from the management book after saving any restaurant you want to keep.

## Saves

- The game automatically saves to the browser's local storage for this site origin. Clearing the browser's site data removes that save.
- **Settings → Save game** writes a JSON snapshot to the checkout's `saves/` directory. **Settings → Load game** loads the most recently modified JSON save and asks before replacing the current session; incompatible saves are rejected.
- File-based save and load require `npm run dev`. They are unavailable with a static deployment or `npm run preview`; browser autosaving remains separate.
- `saves/` is excluded from Git. Back up any snapshots you want to keep.

## Development

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

The CI workflow runs the tests and production build. `npm run build` writes generated output to `dist/`; the development save API is not available in the preview server.

| Path | Purpose |
|---|---|
| `src/canvas/` | Restaurant rendering and spatial interaction |
| `src/components/`, `src/panels/` | Game controls and management interfaces |
| `src/data/` | Menu, equipment, placeable items and progression data |
| `src/simulation/` | Customer flow, staff tasks, cooking, movement and business simulation |
| `src/state/` | Game state, persistence, save validation and recovery |
| `devSavePlugin.js` | Local development-server save API |

## Licence

[MIT](LICENSE)
