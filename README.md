# Shortest Key Path

An interactive visualizer inspired by LeetCode 864, “Shortest Path to Get All Keys.” Design a maze, place keys and locks, then watch breadth-first search animate the optimal route.

## Features

- Editable grids from 3×3 to 30×30
- Bold wall and person pictograms, one start tile, and color-matched A–Z key/lock pairs
- Up to 26 distinct keys and locks using a BigInt bitmask
- Infinite-canvas-style panning with a move tool, two-finger trackpad scrolling, space-drag, middle-drag, or right-drag
- Cursor-centered trackpad pinch and mouse-wheel zoom with no persistent zoom controls
- Colored key and lock pictograms for all 26 letter pairs, without letter labels in the cells
- A slower, thicker animated optimal route with rounded corners and visible U-turn loops
- Chunked BFS with a one-million-state safety limit to keep the page responsive

The visual language mirrors [casimir.dev](https://casimir.dev): white canvas, Lora serif type, black ink, fine gray rules, and a single blue accent for the solved route.

## Run locally

Serve the `dist` directory with any static file server, for example:

```bash
python3 -m http.server 4173 --directory dist
```

Then open `http://localhost:4173`.

## Algorithm

Each BFS state is `(row, column, keyMask)`. A route may revisit the same cell after collecting a different set of keys, so position alone is not enough for the visited set. Because BFS explores routes in increasing step count, the first state containing every key is optimal.

Time and space are bounded by `O(rows × columns × 2^k)` in the worst case.
