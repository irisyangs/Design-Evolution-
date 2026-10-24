# Design Evolution Explorer (React)

A seed for the Design Evolution team. Pick a category, evolve a design by clicking, then send it to a renderer.

## Run it

    npm install
    npm run dev

Then open the address Vite prints (usually http://localhost:5173).

## How it is laid out

- `src/engine.js`: the evolution engine. It knows nothing about mugs or shirts. A design is an object of numbers between 0 and 1.
- `src/domains/`: one file per product family. A domain lists its genes, groups them into features, and has a `draw()` and a `describe()`. `vessels.js` and `tops.js` are the two so far. To add a family, write one file and list it in `domains/index.js`.
- `src/renderers.js`: one entry per renderer, with what it wants sent and a prompt template for it.
- `src/components.jsx`: the drawing tile, the category chooser, the Keep panel, the trail, and the render step.
- `src/App.jsx`: the three steps (choose, evolve, render) and the state.

## FLUX rendering

Step 3 sends the sketch to the Vite development server, which calls `fal-ai/flux-pro/kontext/max/multi` or `fal-ai/trellis` using `FLUX_API_KEY` from `.env`. The key stays on the server and is never bundled into the browser. Restart `npm run dev` after changing `.env`.

The Meshy Text to 3D option sends its renderer prompt to `meshy/v7.1/text-to-3d` through fal using `FLUX_API_KEY`, then provides the resulting textured GLB model for download.

Tripo has two options: `Tripo via fal` uses `FLUX_API_KEY`, while `Tripo direct API` uploads the sketch to Tripo and uses `TRIPO_API_KEY` (or the existing `TRIP0_API_KEY` spelling) from `.env`.

## What is not built

- Other renderers (including 3D model generation) are not connected. FLUX currently returns a photorealistic 2D product render.
- The prompt templates in `renderers.js` are untested against real outputs.
- The tops drawing is a first pass: 14 genes, flat front view.
- Nothing is saved between sessions. The click log lives in memory (`log` in `App.jsx`).

## Scripted states, for screenshots

Add `?demo=tops`, `?demo=keep`, or `?demo=render` to the address.
