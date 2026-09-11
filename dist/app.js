(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const els = {
    grid: $("#grid"),
    stage: $("#gridStage"),
    viewport: $("#gridViewport"),
    overlay: $("#pathOverlay"),
    halo: $("#pathHalo"),
    line: $("#pathLine"),
    rows: $("#rowInput"),
    cols: $("#colInput"),
    settingsButton: $("#settingsButton"),
    settingsPopover: $("#settingsPopover"),
    addButton: $("#addButton"),
    addPopover: $("#addPopover"),
    lockButton: $("#lockMenuButton"),
    lockPicker: $("#lockPicker"),
    lockChoices: $("#lockChoices"),
    wallTool: $("#wallToolGlyph"),
    startTool: $("#startToolGlyph"),
    keyTool: $("#keyToolGlyph"),
    lockTool: $("#lockToolGlyph"),
    run: $("#runButton"),
    runIcon: $("#runIcon"),
    status: $("#statusMessage"),
    toast: $("#toast"),
  };

  const sample = [
    "............",
    ".@...#....c.",
    ".###.#.####.",
    ".a...#...C..",
    ".###.###.#..",
    ".b.B.....#..",
    ".#####.###..",
    "............",
  ];
  const directions = [[0, 1], [1, 0], [0, -1], [-1, 0]];
  const baseCellSize = 44;

  let rows = sample.length;
  let cols = sample[0].length;
  let cells = sample.map((line) => [...line]);
  let selectedTool = "pan";
  let isPainting = false;
  let isPanning = false;
  let spaceHeld = false;
  let panOrigin = null;
  let solveToken = 0;
  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let lastPath = null;
  let lastResult = null;
  let selectedKeyLetter = "a";
  let selectedLockLetter = null;
  let toastTimer;

  const keyIcon = () => `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="7.5" cy="15.5" r="4.5"></circle>
      <path d="M10.7 12.3 21 2"></path>
      <path d="m15.5 7.5 2.8 2.8"></path>
      <path d="m18.2 4.8 2.8 2.8"></path>
    </svg>`;
  const lockIcon = () => `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4" y="10" width="16" height="11" rx="2.4"></rect>
      <path d="M8 10V7a4 4 0 0 1 8 0v3"></path>
      <circle cx="12" cy="15.5" r="1.1"></circle>
      <path d="M12 16.6V19"></path>
    </svg>`;
  const personIcon = () => `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="7" r="3.2"></circle>
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0"></path>
    </svg>`;
  const wallIcon = () => `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2.5" y="4" width="19" height="16" rx="1"></rect>
      <path d="M2.5 9.3h19M2.5 14.7h19M8.8 4v5.3M15.2 4v5.3M6 9.3v5.4M13 9.3v5.4M18.2 9.3v5.4M8.8 14.7V20M15.2 14.7V20"></path>
    </svg>`;

  function colorForLetter(letter) {
    const index = letter.toLowerCase().charCodeAt(0) - 97;
    const hue = (20 + index * 137.508) % 360;
    const lightness = index % 3 === 1 ? 42 : 49;
    return `hsl(${hue} 72% ${lightness}%)`;
  }

  function gridLetters(pattern) {
    const found = new Set();
    cells.forEach((line) => line.forEach((value) => {
      if (pattern.test(value)) found.add(value.toLowerCase());
    }));
    return [...found].sort();
  }

  function nextUnusedKey() {
    const used = new Set(gridLetters(/[a-z]/));
    for (let code = 97; code <= 122; code += 1) {
      const letter = String.fromCharCode(code);
      if (!used.has(letter)) return letter;
    }
    return null;
  }

  function availableLocks() {
    const keys = gridLetters(/[a-z]/);
    const locks = new Set(gridLetters(/[A-Z]/));
    return keys.filter((letter) => !locks.has(letter));
  }

  function updateAddMenu() {
    selectedKeyLetter = nextUnusedKey();
    const lockLetters = availableLocks();
    const previewLock = selectedLockLetter && lockLetters.includes(selectedLockLetter)
      ? selectedLockLetter
      : lockLetters[0] || gridLetters(/[a-z]/)[0] || "a";

    els.wallTool.innerHTML = wallIcon();
    els.startTool.innerHTML = personIcon();
    els.keyTool.innerHTML = keyIcon();
    els.lockTool.innerHTML = lockIcon();
    els.keyTool.style.color = colorForLetter(selectedKeyLetter || "a");
    els.lockTool.style.color = colorForLetter(previewLock);
    $("#keyMenuButton").disabled = !selectedKeyLetter;
    renderLockChoices(lockLetters);
  }

  function blankGrid(nextRows, nextCols) {
    return Array.from({ length: nextRows }, () => Array(nextCols).fill("."));
  }

  function removeOrphanLocks() {
    const keys = new Set(gridLetters(/[a-z]/));
    cells.forEach((line, row) => line.forEach((value, col) => {
      if (/[A-Z]/.test(value) && !keys.has(value.toLowerCase())) cells[row][col] = ".";
    }));
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    els.toast.textContent = message;
    els.toast.classList.add("show");
    toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2200);
  }

  function closePopovers() {
    els.settingsPopover.hidden = true;
    els.settingsButton.setAttribute("aria-expanded", "false");
    els.addPopover.hidden = true;
    els.addButton.setAttribute("aria-expanded", "false");
    els.lockPicker.hidden = true;
    els.lockButton.setAttribute("aria-expanded", "false");
  }

  function togglePopover(name) {
    const popover = name === "settings" ? els.settingsPopover : els.addPopover;
    const button = name === "settings" ? els.settingsButton : els.addButton;
    const opening = popover.hidden;
    closePopovers();
    if (opening) {
      popover.hidden = false;
      button.setAttribute("aria-expanded", "true");
    }
    if (opening && name === "add") updateAddMenu();
    if (opening && name === "settings") requestAnimationFrame(() => els.rows.focus());
  }

  function renderLockChoices(letters = availableLocks()) {
    els.lockChoices.replaceChildren();
    els.lockChoices.style.gridTemplateColumns = `repeat(${Math.min(4, Math.max(1, letters.length))}, 36px)`;
    letters.forEach((letter) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "lock-choice";
      button.setAttribute("role", "menuitem");
      button.setAttribute("aria-label", `Lock matching key ${letter.toUpperCase()}`);
      button.style.color = colorForLetter(letter);
      button.innerHTML = lockIcon();
      button.addEventListener("click", () => {
        selectedLockLetter = letter;
        setTool("lock");
        closePopovers();
      });
      els.lockChoices.append(button);
    });
  }

  function selectNextKey() {
    const next = nextUnusedKey();
    if (!next) {
      showToast("All 26 keys are already on the grid.");
      return;
    }
    selectedKeyLetter = next;
    setTool("key");
    closePopovers();
  }

  function openLockPicker() {
    const choices = availableLocks();
    if (!gridLetters(/[a-z]/).length) {
      showToast("Place a key first.");
      return;
    }
    if (!choices.length) {
      showToast("Every key already has a matching lock.");
      return;
    }
    renderLockChoices(choices);
    els.lockPicker.hidden = !els.lockPicker.hidden;
    els.lockButton.setAttribute("aria-expanded", String(!els.lockPicker.hidden));
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

  function tileMarkup(value) {
    if (value === "#") return wallIcon();
    if (value === "@") return personIcon();
    if (!/[a-zA-Z]/.test(value)) return "";
    return /[a-z]/.test(value) ? keyIcon() : lockIcon();
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
      glyph.innerHTML = tileMarkup(value);
      if (/[a-zA-Z]/.test(value)) glyph.style.setProperty("--tile-color", colorForLetter(value));
      cell.append(glyph);
      fragment.append(cell);
    }));
    els.grid.append(fragment);
    updateAddMenu();
    clearPath();
  }

  function updateTransform() {
    els.stage.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  }

  function centerGrid() {
    panX = (els.viewport.clientWidth - cols * baseCellSize * zoom) / 2;
    panY = (els.viewport.clientHeight - rows * baseCellSize * zoom) / 2;
    updateTransform();
  }

  function resetResult(status = "Ready") {
    solveToken += 1;
    lastResult = null;
    els.run.classList.remove("running");
    els.runIcon.textContent = "▶";
    els.run.setAttribute("aria-label", "Run breadth-first search");
    els.status.textContent = status;
  }

  function clearPath() {
    lastPath = null;
    [els.halo, els.line].forEach((line) => {
      line.classList.remove("animate");
      line.setAttribute("d", "");
    });
  }

  function setTool(tool) {
    selectedTool = tool;
    els.viewport.classList.toggle("pan-mode", tool === "pan");
    $$(".tool").forEach((button) => {
      const active = button.dataset.tool === tool;
      button.classList.toggle("active", active);
      if (button.hasAttribute("aria-pressed")) button.setAttribute("aria-pressed", String(active));
    });
    els.addButton.classList.toggle("active", ["wall", "start", "key", "lock"].includes(tool));
  }

  function valueForTool() {
    if (selectedTool === "wall") return "#";
    if (selectedTool === "start") return "@";
    if (selectedTool === "key") return selectedKeyLetter;
    if (selectedTool === "lock") return selectedLockLetter?.toUpperCase() || ".";
    return ".";
  }

  function paintCell(r, c) {
    if (selectedTool === "pan" || spaceHeld || isPanning) return;
    const value = valueForTool();
    const previousValue = cells[r][c];
    if (["key", "lock"].includes(selectedTool) && /[a-zA-Z]/.test(previousValue)) {
      showToast("Choose a cell without a key or lock.");
      return;
    }
    if (/[a-z]/.test(previousValue) && previousValue !== value) {
      const matchingLock = previousValue.toUpperCase();
      cells.forEach((line, row) => line.forEach((cell, col) => {
        if (cell === matchingLock) cells[row][col] = ".";
      }));
    }
    if (value === "@") {
      cells.forEach((line, row) => line.forEach((cell, col) => {
        if (cell === "@") cells[row][col] = ".";
      }));
    }
    cells[r][c] = value;
    if (selectedTool === "key") selectedKeyLetter = null;
    if (selectedTool === "lock") selectedLockLetter = null;
    renderGrid();
    resetResult("Grid updated");
    if (selectedTool === "key") {
      const next = nextUnusedKey();
      if (next) selectedKeyLetter = next;
      else setTool("pan");
    }
    if (selectedTool === "lock") setTool("pan");
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
    removeOrphanLocks();
    els.rows.value = rows;
    els.cols.value = cols;
    renderGrid();
    resetResult("Grid resized");
    centerGrid();
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
        if (/[a-z]/.test(cell)) mask |= keyBit(cell);
        const id = stateId(nr, nc, mask);
        if (visited.has(id)) continue;
        visited.add(id);
        previous.set(id, current.id);
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
      lastResult = { minimumSteps: -1, statesSeen: visited.size };
      els.status.textContent = visited.size >= 1_000_000 ? "State limit reached" : "No route";
      return;
    }

    const ids = [];
    let cursor = goal.id;
    while (cursor) {
      ids.push(cursor);
      cursor = previous.get(cursor);
    }
    ids.reverse();
    lastResult = { minimumSteps: goal.steps, statesSeen: visited.size };
    els.status.textContent = `${goal.steps} steps, ${visited.size} states`;
    animatePath(ids.map(parseState));
  }

  function roundedPathData(path) {
    const points = path.map(([r, c]) => ({
      x: c * baseCellSize + baseCellSize / 2,
      y: r * baseCellSize + baseCellSize / 2,
    }));
    if (!points.length) return "";
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

    const same = (a, b) => a.x === b.x && a.y === b.y;
    const unit = (a, b) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy) || 1;
      return { x: dx / length, y: dy / length };
    };
    let data = `M ${points[0].x} ${points[0].y}`;

    for (let i = 1; i < points.length; i += 1) {
      const previous = points[i - 1];
      const current = points[i];
      const next = points[i + 1];

      if (next && same(previous, next)) {
        const incoming = unit(previous, current);
        const side = i % 2 ? 1 : -1;
        const perpendicular = { x: -incoming.y * side, y: incoming.x * side };
        const loopWidth = baseCellSize * .3;
        data += ` L ${current.x} ${current.y}`;
        data += ` C ${current.x + perpendicular.x * loopWidth} ${current.y + perpendicular.y * loopWidth}`;
        data += ` ${next.x + perpendicular.x * loopWidth} ${next.y + perpendicular.y * loopWidth}`;
        data += ` ${next.x} ${next.y}`;
        i += 1;
        continue;
      }

      if (next) {
        const incoming = unit(previous, current);
        const outgoing = unit(current, next);
        const radius = baseCellSize * .22;
        const entry = { x: current.x - incoming.x * radius, y: current.y - incoming.y * radius };
        const exit = { x: current.x + outgoing.x * radius, y: current.y + outgoing.y * radius };
        data += ` L ${entry.x} ${entry.y} Q ${current.x} ${current.y} ${exit.x} ${exit.y}`;
      } else {
        data += ` L ${current.x} ${current.y}`;
      }
    }
    return data;
  }

  function drawPath(path, animate) {
    els.overlay.setAttribute("width", cols * baseCellSize);
    els.overlay.setAttribute("height", rows * baseCellSize);
    els.overlay.setAttribute("viewBox", `0 0 ${cols * baseCellSize} ${rows * baseCellSize}`);
    const pathData = roundedPathData(path);
    [els.halo, els.line].forEach((line) => {
      line.classList.remove("animate");
      line.setAttribute("d", pathData);
    });
    const length = els.line.getTotalLength();
    const duration = `${Math.min(12, Math.max(3, path.length * .16))}s`;
    [els.halo, els.line].forEach((line) => {
      line.style.setProperty("--path-length", length);
      line.style.setProperty("--path-duration", duration);
      line.style.strokeDasharray = length;
      line.style.strokeDashoffset = animate ? length : 0;
    });
    if (animate) {
      void els.line.getBoundingClientRect();
      els.halo.classList.add("animate");
      els.line.classList.add("animate");
    }
  }

  function animatePath(path) {
    lastPath = path;
    drawPath(path, true);
  }

  function setZoom(nextZoom, event) {
    const oldZoom = zoom;
    zoom = Math.max(.2, Math.min(4, nextZoom));
    if (oldZoom === zoom) return;
    const rect = els.viewport.getBoundingClientRect();
    const pointerX = event ? event.clientX - rect.left : rect.width / 2;
    const pointerY = event ? event.clientY - rect.top : rect.height / 2;
    const worldX = (pointerX - panX) / oldZoom;
    const worldY = (pointerY - panY) / oldZoom;
    panX = pointerX - worldX * zoom;
    panY = pointerY - worldY * zoom;
    updateTransform();
    if (lastPath) drawPath(lastPath, false);
  }

  function startPan(event) {
    event.preventDefault();
    isPanning = true;
    panOrigin = { x: event.clientX, y: event.clientY, panX, panY };
    els.viewport.classList.add("is-panning");
    els.viewport.setPointerCapture(event.pointerId);
  }

  $$(".direct-tool").forEach((button) => button.addEventListener("click", () => {
    setTool(button.dataset.tool);
    closePopovers();
  }));
  els.settingsButton.addEventListener("click", () => togglePopover("settings"));
  els.addButton.addEventListener("click", () => togglePopover("add"));
  $$('.menu-tool[data-tool="wall"], .menu-tool[data-tool="start"]').forEach((button) => button.addEventListener("click", () => {
    setTool(button.dataset.tool);
    closePopovers();
  }));
  $("#keyMenuButton").addEventListener("click", selectNextKey);
  els.lockButton.addEventListener("click", openLockPicker);
  [els.rows, els.cols].forEach((input) => {
    input.addEventListener("change", applyGridSize);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") input.blur();
    });
  });
  els.run.addEventListener("click", () => {
    closePopovers();
    solve();
  });

  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".toolbar")) closePopovers();
  });

  els.grid.addEventListener("pointerdown", (event) => {
    const cell = event.target.closest(".cell");
    if (!cell || selectedTool === "pan" || spaceHeld || event.button !== 0) return;
    isPainting = true;
    paintCell(Number(cell.dataset.row), Number(cell.dataset.col));
  });
  els.grid.addEventListener("pointerover", (event) => {
    const cell = event.target.closest(".cell");
    if (!cell || !isPainting || !["wall", "erase"].includes(selectedTool)) return;
    paintCell(Number(cell.dataset.row), Number(cell.dataset.col));
  });
  els.viewport.addEventListener("pointerdown", (event) => {
    if (selectedTool === "pan" || spaceHeld || event.button === 1 || event.button === 2) startPan(event);
  });
  els.viewport.addEventListener("pointermove", (event) => {
    if (!isPanning || !panOrigin) return;
    panX = panOrigin.panX + event.clientX - panOrigin.x;
    panY = panOrigin.panY + event.clientY - panOrigin.y;
    updateTransform();
  });
  els.viewport.addEventListener("wheel", (event) => {
    event.preventDefault();
    const mouseWheel = Math.abs(event.deltaY) >= 40 && Math.abs(event.deltaX) < 1;
    if (event.ctrlKey || event.metaKey || mouseWheel) {
      setZoom(zoom * Math.exp(-event.deltaY * (event.ctrlKey || event.metaKey ? .006 : .0025)), event);
    } else {
      panX -= event.deltaX;
      panY -= event.deltaY;
      updateTransform();
    }
  }, { passive: false });
  els.viewport.addEventListener("contextmenu", (event) => event.preventDefault());
  els.viewport.addEventListener("dblclick", (event) => {
    if (selectedTool === "pan") centerGrid();
  });
  window.addEventListener("pointerup", () => {
    isPainting = false;
    isPanning = false;
    panOrigin = null;
    els.viewport.classList.remove("is-panning");
  });
  window.addEventListener("keydown", (event) => {
    if (document.activeElement.tagName === "INPUT") return;
    if (event.code === "Space") {
      event.preventDefault();
      spaceHeld = true;
      return;
    }
    if (event.key === "Escape") {
      closePopovers();
      return;
    }
    const key = event.key.toLowerCase();
    const tools = { p: "pan", w: "wall", e: "erase", s: "start" };
    if (tools[key]) setTool(tools[key]);
    if (key === "k") selectNextKey();
    if (key === "l") {
      els.addPopover.hidden = false;
      els.addButton.setAttribute("aria-expanded", "true");
      openLockPicker();
    }
  });
  window.addEventListener("keyup", (event) => {
    if (event.code === "Space") spaceHeld = false;
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
          centerGrid();
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
          return { ...lastResult, status: els.status.textContent };
        },
      },
    ];
    tools.forEach((tool) => { try { void Promise.resolve(context.registerTool(tool)).catch(() => {}); } catch (_) {} });
  }

  renderGrid();
  setTool("pan");
  requestAnimationFrame(centerGrid);
  registerWebMCP();
})();
