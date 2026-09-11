(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const els = {
    grid: $("#grid"),
    stage: $("#gridStage"),
    viewport: $("#gridViewport"),
    pathOverlay: $("#pathOverlay"),
    pathLine: $("#pathLine"),
    rows: $("#rowInput"),
    cols: $("#colInput"),
    gridLabel: $("#gridLabel"),
    zoom: $("#zoomSlider"),
    zoomValue: $("#zoomValue"),
    pan: $("#panButton"),
    run: $("#runButton"),
    runLabel: $("#runButtonLabel"),
    runIcon: $("#runIcon"),
    runEyebrow: $("#runEyebrow"),
    runMessage: $("#runMessage"),
    stepMetric: $("#stepMetric"),
    resultState: $("#resultState"),
    keyMetric: $("#keyMetric"),
    lockMetric: $("#lockMetric"),
    visitedMetric: $("#visitedMetric"),
    pathMetric: $("#pathMetric"),
    keyOrder: $("#keyOrder"),
    letter: $("#letterSelect"),
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

  let rows = 8;
  let cols = 12;
  let cells = [];
  let selectedTool = "wall";
  let isPainting = false;
  let panMode = false;
  let isPanning = false;
  let panOrigin = null;
  let solveToken = 0;
  let toastTimer;

  for (let code = 65; code <= 90; code += 1) {
    const option = document.createElement("option");
    option.value = String.fromCharCode(code).toLowerCase();
    option.textContent = String.fromCharCode(code);
    els.letter.append(option);
  }

  function blankGrid(nextRows, nextCols) {
    return Array.from({ length: nextRows }, () => Array(nextCols).fill("."));
  }

  function matrixFromStrings(lines) {
    return lines.map((line) => [...line]);
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("show");
    toastTimer = window.setTimeout(() => els.toast.classList.remove("show"), 2500);
  }

  function glyphFor(value) {
    if (value === "@") return "";
    if (value >= "a" && value <= "z") return `⚿`;
    if (value >= "A" && value <= "Z") return value;
    return "";
  }

  function classFor(value) {
    if (value === "#") return "wall";
    if (value === "@") return "start";
    if (value >= "a" && value <= "z") return "key";
    if (value >= "A" && value <= "Z") return "lock";
    return "floor";
  }

  function labelFor(value, r, c) {
    const at = `row ${r + 1}, column ${c + 1}`;
    if (value === "#") return `Wall at ${at}`;
    if (value === "@") return `Start at ${at}`;
    if (value >= "a" && value <= "z") return `Key ${value.toUpperCase()} at ${at}`;
    if (value >= "A" && value <= "Z") return `Lock ${value} at ${at}`;
    return `Empty cell at ${at}`;
  }

  function renderGrid() {
    els.grid.replaceChildren();
    els.grid.style.setProperty("--rows", rows);
    els.grid.style.setProperty("--cols", cols);
    els.gridLabel.textContent = `${rows} × ${cols} grid`;
    const fragment = document.createDocumentFragment();
    cells.forEach((line, r) => line.forEach((value, c) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `cell ${classFor(value)}`;
      button.dataset.row = r;
      button.dataset.col = c;
      button.setAttribute("role", "gridcell");
      button.setAttribute("aria-label", labelFor(value, r, c));
      const glyph = document.createElement("span");
      glyph.className = "tile-glyph";
      glyph.textContent = glyphFor(value);
      button.append(glyph);
      fragment.append(button);
    }));
    els.grid.append(fragment);
    clearPath(false);
    updateCounts();
  }

  function updateCounts() {
    const flat = cells.flat();
    els.keyMetric.textContent = flat.filter((v) => v >= "a" && v <= "z").length;
    els.lockMetric.textContent = flat.filter((v) => v >= "A" && v <= "Z").length;
  }

  function setTool(tool) {
    selectedTool = tool;
    $$(".tool").forEach((button) => {
      const active = button.dataset.tool === tool;
      button.classList.toggle("active", active);
      button.setAttribute("aria-checked", String(active));
    });
    $("#letterField").style.opacity = tool === "key" || tool === "lock" ? "1" : ".48";
  }

  function valueForTool() {
    if (selectedTool === "wall") return "#";
    if (selectedTool === "start") return "@";
    if (selectedTool === "key") return els.letter.value;
    if (selectedTool === "lock") return els.letter.value.toUpperCase();
    return ".";
  }

  function paintCell(r, c) {
    if (panMode) return;
    const next = valueForTool();
    if (next === "@") {
      cells.forEach((line, row) => line.forEach((value, col) => {
        if (value === "@") cells[row][col] = ".";
      }));
    }
    cells[r][c] = next;
    renderGrid();
    resetResult("Grid updated", "Run BFS to calculate a new shortest route.");
  }

  function applyGridSize() {
    const nextRows = Math.max(3, Math.min(30, Number(els.rows.value) || 8));
    const nextCols = Math.max(3, Math.min(30, Number(els.cols.value) || 12));
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
    resetResult("Grid resized", "Place tiles, then run the search.");
  }

  function resetResult(eyebrow = "Ready to search", message = "Collect every key in the fewest moves.") {
    solveToken += 1;
    els.run.classList.remove("running");
    els.runLabel.textContent = "Run BFS";
    els.runIcon.textContent = "▶";
    els.runEyebrow.textContent = eyebrow;
    els.runMessage.textContent = message;
    els.stepMetric.textContent = "—";
    els.visitedMetric.textContent = "0";
    els.pathMetric.textContent = "0";
    els.resultState.className = "result-state";
    els.resultState.innerHTML = "<span></span>Waiting for a run";
    els.keyOrder.innerHTML = '<span class="empty-order">Run the solver to see the route.</span>';
  }

  function clearPath(reset = true) {
    $$(".cell.path-cell").forEach((cell) => cell.classList.remove("path-cell"));
    els.pathLine.classList.remove("animate");
    els.pathLine.setAttribute("points", "");
    if (reset) resetResult();
  }

  function stateId(r, c, mask) {
    return `${r},${c},${mask.toString(36)}`;
  }

  function parseState(id) {
    const [r, c] = id.split(",");
    return [Number(r), Number(c)];
  }

  function keyBit(letter) {
    return 1n << BigInt(letter.toLowerCase().charCodeAt(0) - 97);
  }

  function validateGrid() {
    const starts = [];
    const keys = new Set();
    const locks = new Set();
    cells.forEach((line, r) => line.forEach((value, c) => {
      if (value === "@") starts.push([r, c]);
      if (value >= "a" && value <= "z") keys.add(value);
      if (value >= "A" && value <= "Z") locks.add(value.toLowerCase());
    }));
    if (starts.length !== 1) return { error: "Place exactly one start tile before running." };
    if (keys.size === 0) return { error: "Add at least one key for the solver to collect." };
    const orphanLocks = [...locks].filter((lock) => !keys.has(lock));
    if (orphanLocks.length) showToast(`Locks without matching keys: ${orphanLocks.map((v) => v.toUpperCase()).join(", ")}`);
    return { start: starts[0], keys };
  }

  function frame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
  }

  async function solve() {
    if (els.run.classList.contains("running")) {
      solveToken += 1;
      els.run.classList.remove("running");
      els.runLabel.textContent = "Run BFS";
      els.runIcon.textContent = "▶";
      els.runEyebrow.textContent = "Search stopped";
      els.runMessage.textContent = "The current grid is ready to run again.";
      return;
    }

    const validation = validateGrid();
    if (validation.error) {
      showToast(validation.error);
      return;
    }

    clearPath(false);
    const token = ++solveToken;
    let allKeys = 0n;
    validation.keys.forEach((key) => { allKeys |= keyBit(key); });
    const [startR, startC] = validation.start;
    const startId = stateId(startR, startC, 0n);
    const queue = [{ r: startR, c: startC, mask: 0n, steps: 0, id: startId }];
    const visited = new Set([startId]);
    const previous = new Map();
    const gained = new Map();
    const directions = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    let head = 0;
    let goal = null;
    const maxStates = 1_000_000;

    els.run.classList.add("running");
    els.runLabel.textContent = "Stop";
    els.runIcon.textContent = "■";
    els.runEyebrow.textContent = "Searching states";
    els.runMessage.textContent = "BFS is exploring every reachable key combination.";
    els.resultState.className = "result-state";
    els.resultState.innerHTML = "<span></span>Search in progress";

    while (head < queue.length && token === solveToken) {
      const current = queue[head++];
      if (current.mask === allKeys) { goal = current; break; }

      for (const [dr, dc] of directions) {
        const nr = current.r + dr;
        const nc = current.c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        const cell = cells[nr][nc];
        if (cell === "#") continue;
        if (cell >= "A" && cell <= "Z" && (current.mask & keyBit(cell)) === 0n) continue;

        let nextMask = current.mask;
        let picked = null;
        if (cell >= "a" && cell <= "z") {
          const bit = keyBit(cell);
          if ((nextMask & bit) === 0n) picked = cell;
          nextMask |= bit;
        }
        const id = stateId(nr, nc, nextMask);
        if (visited.has(id)) continue;
        visited.add(id);
        previous.set(id, current.id);
        if (picked) gained.set(id, picked);
        queue.push({ r: nr, c: nc, mask: nextMask, steps: current.steps + 1, id });
      }

      if (visited.size >= maxStates) break;
      if (head % 4000 === 0) {
        els.visitedMetric.textContent = visited.size.toLocaleString();
        await frame();
      }
    }

    if (token !== solveToken) return;
    els.run.classList.remove("running");
    els.runLabel.textContent = "Run again";
    els.runIcon.textContent = "↻";
    els.visitedMetric.textContent = visited.size.toLocaleString();

    if (!goal) {
      const limited = visited.size >= maxStates;
      els.stepMetric.textContent = "−1";
      els.resultState.className = "result-state failure";
      els.resultState.innerHTML = `<span></span>${limited ? "Safety limit reached" : "No valid route"}`;
      els.runEyebrow.textContent = limited ? "Search paused safely" : "No solution found";
      els.runMessage.textContent = limited
        ? "This maze exceeded 1,000,000 states. Reduce keys or grid size."
        : "At least one key is unreachable with the available keys.";
      els.keyOrder.innerHTML = '<span class="empty-order">No complete key order.</span>';
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
    els.stepMetric.textContent = goal.steps.toLocaleString();
    els.pathMetric.textContent = path.length.toLocaleString();
    els.resultState.className = "result-state success";
    els.resultState.innerHTML = "<span></span>Optimal route found";
    els.runEyebrow.textContent = "Shortest route found";
    els.runMessage.textContent = `${goal.steps} moves · ${visited.size.toLocaleString()} unique states explored`;
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

  function cellSize() {
    return Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--cell"));
  }

  function animatePath(path) {
    const size = cellSize();
    els.pathOverlay.setAttribute("width", cols * size);
    els.pathOverlay.setAttribute("height", rows * size);
    els.pathOverlay.setAttribute("viewBox", `0 0 ${cols * size} ${rows * size}`);
    els.pathLine.setAttribute("points", path.map(([r, c]) => `${c * size + size / 2},${r * size + size / 2}`).join(" "));
    const length = els.pathLine.getTotalLength();
    els.pathLine.style.setProperty("--path-length", length);
    els.pathLine.style.strokeDasharray = length;
    els.pathLine.style.strokeDashoffset = length;
    els.pathLine.style.setProperty("--path-duration", `${Math.min(4.2, Math.max(1, path.length * .055))}s`);
    void els.pathLine.getBoundingClientRect();
    els.pathLine.classList.add("animate");
    path.forEach(([r, c], index) => {
      const cell = els.grid.children[r * cols + c];
      cell.style.setProperty("--delay", `${Math.min(3.7, index * .05)}s`);
      cell.classList.add("path-cell");
    });
  }

  function setZoom(value) {
    const zoom = Math.max(55, Math.min(170, Number(value)));
    els.zoom.value = zoom;
    els.zoomValue.textContent = `${zoom}%`;
    document.documentElement.style.setProperty("--cell", `${46 * zoom / 100}px`);
    if (els.pathLine.getAttribute("points")) clearPath(false);
  }

  $$(".tool").forEach((button) => button.addEventListener("click", () => setTool(button.dataset.tool)));
  $("#applySize").addEventListener("click", applyGridSize);
  $("#sampleButton").addEventListener("click", () => {
    rows = sample.length;
    cols = sample[0].length;
    cells = matrixFromStrings(sample);
    els.rows.value = rows;
    els.cols.value = cols;
    renderGrid();
    resetResult("Sample loaded", "Edit the maze or run it as-is.");
  });
  $("#clearButton").addEventListener("click", () => {
    cells = blankGrid(rows, cols);
    renderGrid();
    resetResult("Grid cleared", "Place a start and at least one key.");
  });
  els.run.addEventListener("click", solve);
  els.zoom.addEventListener("input", (event) => setZoom(event.target.value));
  $("#zoomIn").addEventListener("click", () => setZoom(Number(els.zoom.value) + 10));
  $("#zoomOut").addEventListener("click", () => setZoom(Number(els.zoom.value) - 10));
  els.pan.addEventListener("click", () => {
    panMode = !panMode;
    els.pan.setAttribute("aria-pressed", String(panMode));
    els.viewport.classList.toggle("is-panning", panMode);
  });

  els.grid.addEventListener("pointerdown", (event) => {
    const cell = event.target.closest(".cell");
    if (!cell || panMode) return;
    isPainting = true;
    paintCell(Number(cell.dataset.row), Number(cell.dataset.col));
  });
  els.grid.addEventListener("pointerover", (event) => {
    const cell = event.target.closest(".cell");
    if (!cell || !isPainting || panMode || selectedTool === "start" || selectedTool === "key" || selectedTool === "lock") return;
    paintCell(Number(cell.dataset.row), Number(cell.dataset.col));
  });
  window.addEventListener("pointerup", () => { isPainting = false; isPanning = false; els.viewport.classList.remove("is-dragging"); });

  els.viewport.addEventListener("pointerdown", (event) => {
    if (!panMode) return;
    isPanning = true;
    panOrigin = { x: event.clientX, y: event.clientY, left: els.viewport.scrollLeft, top: els.viewport.scrollTop };
    els.viewport.classList.add("is-dragging");
    els.viewport.setPointerCapture(event.pointerId);
  });
  els.viewport.addEventListener("pointermove", (event) => {
    if (!isPanning || !panOrigin) return;
    els.viewport.scrollLeft = panOrigin.left - (event.clientX - panOrigin.x);
    els.viewport.scrollTop = panOrigin.top - (event.clientY - panOrigin.y);
  });
  els.viewport.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setZoom(Number(els.zoom.value) + (event.deltaY < 0 ? 5 : -5));
  }, { passive: false });

  window.addEventListener("keydown", (event) => {
    if (["INPUT", "SELECT"].includes(document.activeElement.tagName)) return;
    const shortcuts = { w: "wall", e: "erase", s: "start", k: "key", l: "lock" };
    if (shortcuts[event.key.toLowerCase()]) setTool(shortcuts[event.key.toLowerCase()]);
  });

  function registerWebMCP() {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const tools = [
      {
        name: "configure_key_maze",
        title: "Configure key maze",
        description: "Replace the visible maze with rows of equal-length characters using . # @ a-z and A-Z.",
        inputSchema: { type: "object", properties: { grid: { type: "array", minItems: 3, maxItems: 30, items: { type: "string", minLength: 3, maxLength: 30 } } }, required: ["grid"], additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          if (!input || !Array.isArray(input.grid) || input.grid.length < 3 || input.grid.length > 30) throw new Error("Grid must contain 3–30 rows.");
          const width = input.grid[0]?.length;
          if (width < 3 || width > 30 || input.grid.some((line) => line.length !== width || /[^.#@a-zA-Z]/.test(line))) throw new Error("Rows must be 3–30 equal-length valid grid strings.");
          if (input.grid.join("").split("@").length - 1 !== 1) throw new Error("Grid must contain exactly one @ start.");
          rows = input.grid.length; cols = width; cells = matrixFromStrings(input.grid); els.rows.value = rows; els.cols.value = cols; renderGrid(); resetResult("Maze configured", "The new grid is ready to solve.");
          return { rows, columns: cols, keys: Number(els.keyMetric.textContent), locks: Number(els.lockMetric.textContent) };
        },
      },
      {
        name: "run_shortest_key_search",
        title: "Run shortest-key search",
        description: "Run BFS on the visible maze and animate its optimal all-keys route.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
        annotations: { readOnlyHint: false, untrustedContentHint: false },
        async execute() { await solve(); return { minimumSteps: els.stepMetric.textContent, statesSeen: els.visitedMetric.textContent, status: els.resultState.textContent.trim() }; },
      },
    ];
    tools.forEach((tool) => { try { void Promise.resolve(context.registerTool(tool)).catch(() => {}); } catch (_) {} });
  }

  cells = matrixFromStrings(sample);
  renderGrid();
  setTool("wall");
  registerWebMCP();
})();
