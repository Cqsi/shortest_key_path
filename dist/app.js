(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const els = {
    grid: $("#grid"),
    viewport: $("#gridViewport"),
    overlay: $("#pathOverlay"),
    line: $("#pathLine"),
    rows: $("#rowInput"),
    cols: $("#colInput"),
    letter: $("#letterSelect"),
    keyTool: $("#keyToolGlyph"),
    lockTool: $("#lockToolGlyph"),
    run: $("#runButton"),
    runIcon: $("#runIcon"),
    steps: $("#stepMetric"),
    keyOrder: $("#keyOrder"),
    status: $("#statusMessage"),
    zoom: $("#zoomValue"),
    toast: $("#toast"),
  };

  const sample = [
    "............",
    ".@...#....f.",
    ".###.#.####.",
    ".a...#...F..",
    ".###.###.#..",
    ".b.B.....#..",
    ".#####.###..",
    "............",
  ];
  const directions = [[0, 1], [1, 0], [0, -1], [-1, 0]];

  let rows = sample.length;
  let cols = sample[0].length;
  let cells = sample.map((line) => [...line]);
  let selectedTool = "wall";
  let isPainting = false;
  let isPanning = false;
  let spaceHeld = false;
  let panOrigin = null;
  let solveToken = 0;
  let cellSize = 44;
  let lastPath = null;
  let toastTimer;
  let zoomTimer;

  for (let code = 65; code <= 90; code += 1) {
    const option = document.createElement("option");
    option.value = String.fromCharCode(code).toLowerCase();
    option.textContent = String.fromCharCode(code);
    els.letter.append(option);
  }

  function blankGrid(nextRows, nextCols) {
    return Array.from({ length: nextRows }, () => Array(nextCols).fill("."));
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("show");
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2200);
  }

  function classFor(value) {
    if (value === "#") return "wall";
    if (value === "@") return "start";
    if (/[a-z]/.test(value)) return "key";
    if (/[A-Z]/.test(value)) return "lock";
    return "floor";
  }

  function labelFor(value, r, c) {
    const location = `row ${r + 1}, column ${c + 1}`;
    if (value === "#") return `Wall at ${location}`;
    if (value === "@") return `Start at ${location}`;
    if (/[a-z]/.test(value)) return `Key ${value.toUpperCase()} at ${location}`;
    if (/[A-Z]/.test(value)) return `Lock ${value} at ${location}`;
    return `Empty cell at ${location}`;
  }

  function renderGrid() {
    els.grid.replaceChildren();
    els.grid.style.setProperty("--rows", rows);
    els.grid.style.setProperty("--cols", cols);
    const fragment = document.createDocumentFragment();
    cells.forEach((line, r) => line.forEach((value, c) => {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = `cell ${classFor(value)}`;
      cell.dataset.row = r;
      cell.dataset.col = c;
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-label", labelFor(value, r, c));
      const glyph = document.createElement("span");
      glyph.className = "tile-glyph";
      glyph.textContent = /[a-zA-Z]/.test(value) ? value : "";
      cell.append(glyph);
      fragment.append(cell);
    }));
    els.grid.append(fragment);
    clearPath();
  }

  function resetResult(status = "Ready") {
    solveToken += 1;
    els.run.classList.remove("running");
    els.runIcon.textContent = "▶";
    els.run.setAttribute("aria-label", "Run breadth-first search");
    els.steps.textContent = "—";
    els.keyOrder.replaceChildren();
    els.status.textContent = status;
  }

  function clearPath() {
    lastPath = null;
    $$(".cell.path-cell").forEach((cell) => cell.classList.remove("path-cell"));
    els.line.classList.remove("animate");
    els.line.setAttribute("points", "");
  }

  function setTool(tool) {
    selectedTool = tool;
    $$(".tool").forEach((button) => {
      const active = button.dataset.tool === tool;
      button.classList.toggle("active", active);
      button.setAttribute("aria-checked", String(active));
    });
  }

  function valueForTool() {
    if (selectedTool === "wall") return "#";
    if (selectedTool === "start") return "@";
    if (selectedTool === "key") return els.letter.value;
    if (selectedTool === "lock") return els.letter.value.toUpperCase();
    return ".";
  }

  function paintCell(r, c) {
    if (spaceHeld || isPanning) return;
    const value = valueForTool();
    if (value === "@") {
      cells.forEach((line, row) => line.forEach((cell, col) => {
        if (cell === "@") cells[row][col] = ".";
      }));
    }
    cells[r][c] = value;
    renderGrid();
    resetResult("Grid updated");
  }

  function applyGridSize() {
    const nextRows = Math.max(3, Math.min(30, Number(els.rows.value) || rows));
    const nextCols = Math.max(3, Math.min(30, Number(els.cols.value) || cols));
    const next = blankGrid(nextRows, nextCols);
    for (let r = 0; r < Math.min(rows, nextRows); r += 1) {
      for (let c = 0; c < Math.min(cols, nextCols); c += 1) next[r][c] = cells[r][c];
    }
    rows = nextRows;
    cols = nextCols;
    cells = next;
    els.rows.value = rows;
    els.cols.value = cols;
    renderGrid();
    resetResult("Grid resized");
  }

  function keyBit(letter) {
    return 1n << BigInt(letter.toLowerCase().charCodeAt(0) - 97);
  }

  function stateId(r, c, mask) {
    return `${r},${c},${mask.toString(36)}`;
  }

  function parseState(id) {
    const [r, c] = id.split(",");
    return [Number(r), Number(c)];
  }

  function validateGrid() {
    let start = null;
    let starts = 0;
    const keys = new Set();
    cells.forEach((line, r) => line.forEach((value, c) => {
      if (value === "@") { start = [r, c]; starts += 1; }
      if (/[a-z]/.test(value)) keys.add(value);
    }));
    if (starts !== 1) return { error: "Place one start point." };
    if (!keys.size) return { error: "Place at least one key." };
    return { start, keys };
  }

  function frame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
  }

  async function solve() {
    if (els.run.classList.contains("running")) {
      solveToken += 1;
      resetResult("Stopped");
      return;
    }
    const validation = validateGrid();
    if (validation.error) { showToast(validation.error); return; }

    clearPath();
    const token = ++solveToken;
    let allKeys = 0n;
    validation.keys.forEach((key) => { allKeys |= keyBit(key); });
    const [startR, startC] = validation.start;
    const start = stateId(startR, startC, 0n);
    const queue = [{ r: startR, c: startC, mask: 0n, steps: 0, id: start }];
    const visited = new Set([start]);
    const previous = new Map();
    const gained = new Map();
    let head = 0;
    let goal = null;

    els.run.classList.add("running");
    els.runIcon.textContent = "■";
    els.run.setAttribute("aria-label", "Stop search");
    els.status.textContent = "Searching";

    while (head < queue.length && token === solveToken) {
      const current = queue[head++];
      if (current.mask === allKeys) { goal = current; break; }
      for (const [dr, dc] of directions) {
        const nr = current.r + dr;
        const nc = current.c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        const cell = cells[nr][nc];
        if (cell === "#") continue;
        if (/[A-Z]/.test(cell) && (current.mask & keyBit(cell)) === 0n) continue;
        let mask = current.mask;
        let picked = null;
        if (/[a-z]/.test(cell)) {
          const bit = keyBit(cell);
          if ((mask & bit) === 0n) picked = cell;
          mask |= bit;
        }
        const id = stateId(nr, nc, mask);
        if (visited.has(id)) continue;
        visited.add(id);
        previous.set(id, current.id);
        if (picked) gained.set(id, picked);
        queue.push({ r: nr, c: nc, mask, steps: current.steps + 1, id });
      }
      if (visited.size >= 1_000_000) break;
      if (head % 4000 === 0) await frame();
    }

    if (token !== solveToken) return;
    els.run.classList.remove("running");
    els.runIcon.textContent = "↻";
    els.run.setAttribute("aria-label", "Run again");

    if (!goal) {
      els.steps.textContent = "−1";
      els.status.textContent = visited.size >= 1_000_000 ? "State limit reached" : "No route";
      return;
    }

    const ids = [];
    const order = [];
    let cursor = goal.id;
    while (cursor) {
      ids.push(cursor);
      if (gained.has(cursor)) order.push(gained.get(cursor));
      cursor = previous.get(cursor);
    }
    ids.reverse();
    order.reverse();
    const path = ids.map(parseState);
    els.steps.textContent = goal.steps;
    els.status.textContent = `${goal.steps} steps, ${visited.size} states`;
    els.keyOrder.replaceChildren();
    order.forEach((key, index) => {
      if (index) {
        const arrow = document.createElement("span");
        arrow.className = "order-arrow";
        arrow.textContent = "→";
        els.keyOrder.append(arrow);
      }
      const chip = document.createElement("span");
      chip.className = "key-chip";
      chip.textContent = key;
      els.keyOrder.append(chip);
    });
    animatePath(path);
  }

  function drawPath(path, animate) {
    els.overlay.setAttribute("width", cols * cellSize);
    els.overlay.setAttribute("height", rows * cellSize);
    els.overlay.setAttribute("viewBox", `0 0 ${cols * cellSize} ${rows * cellSize}`);
    els.line.setAttribute("points", path.map(([r, c]) => `${c * cellSize + cellSize / 2},${r * cellSize + cellSize / 2}`).join(" "));
    const length = els.line.getTotalLength();
    els.line.style.setProperty("--path-length", length);
    els.line.style.strokeDasharray = length;
    els.line.style.strokeDashoffset = animate ? length : 0;
    els.line.style.setProperty("--path-duration", `${Math.min(4, Math.max(.8, path.length * .05))}s`);
    if (animate) {
      void els.line.getBoundingClientRect();
      els.line.classList.add("animate");
      path.forEach(([r, c], index) => {
        const cell = els.grid.children[r * cols + c];
        cell.style.setProperty("--delay", `${Math.min(3.5, index * .045)}s`);
        cell.classList.add("path-cell");
      });
    }
  }

  function animatePath(path) {
    lastPath = path;
    drawPath(path, true);
  }

  function setZoom(next, event) {
    const oldSize = cellSize;
    cellSize = Math.max(24, Math.min(84, next));
    if (oldSize === cellSize) return;
    const rect = els.viewport.getBoundingClientRect();
    const localX = event ? event.clientX - rect.left : els.viewport.clientWidth / 2;
    const localY = event ? event.clientY - rect.top : els.viewport.clientHeight / 2;
    const x = localX + els.viewport.scrollLeft;
    const y = localY + els.viewport.scrollTop;
    const ratio = cellSize / oldSize;
    document.documentElement.style.setProperty("--cell", `${cellSize}px`);
    els.viewport.scrollLeft = x * ratio - localX;
    els.viewport.scrollTop = y * ratio - localY;
    els.zoom.textContent = `${Math.round(cellSize / 44 * 100)}%`;
    els.zoom.classList.add("visible");
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(() => els.zoom.classList.remove("visible"), 700);
    if (lastPath) drawPath(lastPath, false);
  }

  $$(".tool").forEach((button) => button.addEventListener("click", () => setTool(button.dataset.tool)));
  $("#applySize").addEventListener("click", applyGridSize);
  els.letter.addEventListener("change", () => {
    els.keyTool.textContent = els.letter.value;
    els.lockTool.textContent = els.letter.value.toUpperCase();
  });
  $("#sampleButton").addEventListener("click", () => {
    rows = sample.length;
    cols = sample[0].length;
    cells = sample.map((line) => [...line]);
    els.rows.value = rows;
    els.cols.value = cols;
    renderGrid();
    resetResult("Sample loaded");
  });
  $("#clearButton").addEventListener("click", () => {
    cells = blankGrid(rows, cols);
    renderGrid();
    resetResult("Grid cleared");
  });
  els.run.addEventListener("click", solve);

  els.grid.addEventListener("pointerdown", (event) => {
    const cell = event.target.closest(".cell");
    if (!cell || spaceHeld || event.button !== 0) return;
    isPainting = true;
    paintCell(Number(cell.dataset.row), Number(cell.dataset.col));
  });
  els.grid.addEventListener("pointerover", (event) => {
    const cell = event.target.closest(".cell");
    if (!cell || !isPainting || spaceHeld || !["wall", "erase"].includes(selectedTool)) return;
    paintCell(Number(cell.dataset.row), Number(cell.dataset.col));
  });
  els.viewport.addEventListener("wheel", (event) => {
    event.preventDefault();
    const strength = event.ctrlKey ? 0.18 : 0.06;
    setZoom(cellSize - event.deltaY * strength, event);
  }, { passive: false });
  els.viewport.addEventListener("pointerdown", (event) => {
    if (!(spaceHeld || event.button === 1)) return;
    event.preventDefault();
    isPanning = true;
    panOrigin = { x: event.clientX, y: event.clientY, left: els.viewport.scrollLeft, top: els.viewport.scrollTop };
    els.viewport.classList.add("is-panning");
    els.viewport.setPointerCapture(event.pointerId);
  });
  els.viewport.addEventListener("pointermove", (event) => {
    if (!isPanning || !panOrigin) return;
    els.viewport.scrollLeft = panOrigin.left - (event.clientX - panOrigin.x);
    els.viewport.scrollTop = panOrigin.top - (event.clientY - panOrigin.y);
  });
  window.addEventListener("pointerup", () => {
    isPainting = false;
    isPanning = false;
    els.viewport.classList.remove("is-panning");
  });
  window.addEventListener("keydown", (event) => {
    if (["INPUT", "SELECT"].includes(document.activeElement.tagName)) return;
    if (event.code === "Space") {
      event.preventDefault();
      spaceHeld = true;
      els.viewport.classList.add("space-held");
      return;
    }
    const tools = { w: "wall", e: "erase", s: "start", k: "key", l: "lock" };
    if (tools[event.key.toLowerCase()]) setTool(tools[event.key.toLowerCase()]);
  });
  window.addEventListener("keyup", (event) => {
    if (event.code === "Space") {
      spaceHeld = false;
      isPanning = false;
      els.viewport.classList.remove("space-held", "is-panning");
    }
  });

  function registerWebMCP() {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const tools = [
      {
        name: "configure_key_maze",
        title: "Configure key maze",
        description: "Replace the visible maze with equal-length rows using . # @ a-z and A-Z.",
        inputSchema: { type: "object", properties: { grid: { type: "array", minItems: 3, maxItems: 30, items: { type: "string", minLength: 3, maxLength: 30 } } }, required: ["grid"], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          if (!input || !Array.isArray(input.grid) || input.grid.length < 3 || input.grid.length > 30) throw new Error("Grid must contain 3–30 rows.");
          const width = input.grid[0]?.length;
          if (width < 3 || width > 30 || input.grid.some((line) => line.length !== width || /[^.#@a-zA-Z]/.test(line))) throw new Error("Rows must be 3–30 equal-length valid grid strings.");
          if (input.grid.join("").split("@").length - 1 !== 1) throw new Error("Grid must contain exactly one @ start.");
          rows = input.grid.length;
          cols = width;
          cells = input.grid.map((line) => [...line]);
          els.rows.value = rows;
          els.cols.value = cols;
          renderGrid();
          resetResult("Maze configured");
          return { rows, columns: cols };
        },
      },
      {
        name: "run_shortest_key_search",
        title: "Run shortest-key search",
        description: "Run BFS on the visible maze and animate its optimal all-keys route.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        async execute() {
          await solve();
          return { minimumSteps: els.steps.textContent, status: els.status.textContent };
        },
      },
    ];
    tools.forEach((tool) => { try { void Promise.resolve(context.registerTool(tool)).catch(() => {}); } catch (_) {} });
  }

  renderGrid();
  setTool("wall");
  registerWebMCP();
})();
