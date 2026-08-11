# Help Desk Auto-Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Manifest V3 Chrome/Edge extension that clicks the Help Desk "Atualizar" button at user-defined intervals without reloading the page.

**Architecture:** Content-script-only (no background service worker, no `chrome.alarms`). `setInterval` lives in `content.js` injected only into the Help Desk domain declared in `manifest.json` `matches`. Config persisted in `chrome.storage.sync`. Refresh success confirmed by watching `location.hash` for the app's `dispatch=refresh` marker after each click.

**Tech Stack:** Vanilla JS (ES2020+), Chrome Extension Manifest V3 APIs (`chrome.storage`, `chrome.runtime`), HTML/CSS. No bundler, no dependencies, no test framework.

## Global Constraints

- **Manifest V3** — `"manifest_version": 3`.
- **Permissions:** `["storage"]` only. No `host_permissions`, no `<all_urls>`, no `tabs`, no `scripting`, no `alarms`.
- **Domain:** fixed in `manifest.json` `content_scripts[0].matches`. Placeholder: `https://meu-helpdesk.exemplo.com.br/*/application.do*`. User replaces with real domain later; reload extension after.
- **Button ID:** `homepage.pane.panel_refreshIcon` (located via `document.getElementById`).
- **Refresh hash marker:** `dispatch=refresh`.
- **Interval minimum:** 1 minute (`MIN_INTERVAL_MIN`). Default: 1 minute.
- **No `location.reload()`**, no `window.open()`, no external network calls, no DOM mutation beyond `.click()`.
- **Storage:** `chrome.storage.sync`. Keys: `hd_active`, `hd_intervalMin`, `hd_lastUpdate`, `hd_lastStatus`.
- **Language:** UI text in Portuguese (pt-BR).
- **Testing:** manual (no browser-automation framework in this project). Each task ends with a manual verification step using DevTools console on a live Help Desk page or a local test HTML page that mimics the button.

---

## File Structure

```
manifest.json          # MV3 config, matches = domain (single edit point)
config.js              # constants: BUTTON_ID, defaults, STORAGE_KEYS, hash marker
content.js             # timer + click + hash confirmation + storage sync
popup.html             # popup UI (status box + controls)
popup.js               # read/write storage, wire controls, render status
styles.css             # popup styling
icons/icon16.png       # toolbar icon (small)
icons/icon48.png       # extensions page icon
icons/icon128.png      # web store / install icon
```

**Responsibility boundaries:**
- `config.js` — pure constants. No logic. Loaded by both `content.js` and `popup.js` (declares `const`s in global scope of each context).
- `content.js` — all page-interaction logic. Owns the timer lifecycle and click/confirm cycle. Reads/writes `lastUpdate`/`lastStatus`.
- `popup.js` — all popup-interaction logic. Owns config form (`active`, `intervalMin`) writes. Never touches the page directly (broadcasts `refreshNow` message).
- `popup.html` — structure only, no inline script/style.
- `styles.css` — presentation only.
- `manifest.json` — declarative wiring; single `matches` edit point for the domain.

---

## Task 1: Scaffold manifest.json and config.js

**Files:**
- Create: `manifest.json`
- Create: `config.js`

**Interfaces:**
- Produces (global `const`s, available to `content.js` and `popup.js` because both load `config.js` before their own script):
  - `BUTTON_ID: string` = `"homepage.pane.panel_refreshIcon"`
  - `HELPDESK_URL: string` = `"https://meu-helpdesk.exemplo.com.br/*/application.do*"`
  - `REFRESH_HASH_MARKER: string` = `"dispatch=refresh"`
  - `REFRESH_CONFIRM_TIMEOUT_MS: number` = `2000`
  - `DEFAULT_INTERVAL_MIN: number` = `1`
  - `MIN_INTERVAL_MIN: number` = `1`
  - `DEFAULT_ACTIVE: boolean` = `false`
  - `STORAGE_KEYS: {active, intervalMin, lastUpdate, lastStatus}` with values `"hd_active"`, `"hd_intervalMin"`, `"hd_lastUpdate"`, `"hd_lastStatus"`.

- [ ] **Step 1: Create `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Help Desk Auto-Refresh",
  "version": "1.0.0",
  "description": "Atualiza a lista de chamados do Help Desk clicando no botão Atualizar em intervalos definidos.",
  "permissions": ["storage"],
  "content_scripts": [
    {
      "matches": ["https://meu-helpdesk.exemplo.com.br/*/application.do*"],
      "js": ["config.js", "content.js"],
      "run_at": "document_idle"
    }
  ],
  "action": {
    "default_popup": "popup.html",
    "default_title": "Help Desk Auto-Refresh"
  },
  "icons": {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  }
}
```

- [ ] **Step 2: Create `config.js`**

```javascript
// ============================================================
// CONFIGURAÇÃO — EDITAR AQUI
// ============================================================

// ID do botão "Atualizar" na interface do Help Desk.
const BUTTON_ID = "homepage.pane.panel_refreshIcon";

// Domínio/padrão do Help Desk. DEVE bater com "matches" no manifest.json.
const HELPDESK_URL = "https://meu-helpdesk.exemplo.com.br/*/application.do*";

// Marcador no hash que confirma que o refresh foi processado pela aplicação.
const REFRESH_HASH_MARKER = "dispatch=refresh";

// Tempo máximo (ms) esperando o hash mudar antes de marcar "não respondeu".
const REFRESH_CONFIRM_TIMEOUT_MS = 2000;

// Intervalo padrão (minutos) na primeira execução.
const DEFAULT_INTERVAL_MIN = 1;

// Intervalo mínimo permitido.
const MIN_INTERVAL_MIN = 1;

// Estado ativo por padrão.
const DEFAULT_ACTIVE = false;

// Chaves de storage.
const STORAGE_KEYS = {
  active: "hd_active",
  intervalMin: "hd_intervalMin",
  lastUpdate: "hd_lastUpdate",
  lastStatus: "hd_lastStatus", // "confirmed" | "noResponse" | "waiting"
};
// ============================================================
```

- [ ] **Step 3: Verify JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('OK')"`
Expected: prints `OK`, exit 0. (If `node` unavailable, paste into https://jsonlint.com — must report valid.)

- [ ] **Step 4: Commit**

```bash
git add manifest.json config.js
git commit -m "feat: scaffold manifest.json and config constants"
```

---

## Task 2: Standalone test harness for content.js logic

A pure-JS test page that mimics the Help Desk button and hash behavior, so the click+confirm cycle in `content.js` can be verified without the real site. This harness is used in Tasks 3 and 5.

**Files:**
- Create: `test/harness.html`

**Interfaces:**
- Produces: a local page at `file:///.../test/harness.html` containing a `<span id="homepage.pane.panel_refreshIcon" title="Atualizar">` whose click handler appends `#welcome%2FWelcomeDispatchAction.do?dispatch=refresh` to `location.hash`. Used to drive `content.js` manually during development.

- [ ] **Step 1: Create `test/harness.html`**

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Help Desk Auto-Refresh — Test Harness</title>
  <style>
    body { font-family: sans-serif; padding: 20px; }
    #homepage\.pane\.panel_refreshIcon {
      display: inline-block; cursor: pointer; padding: 6px 12px;
      background: #1a73e8; color: white; border-radius: 4px;
    }
    #log { margin-top: 20px; font-family: monospace; white-space: pre-wrap;
           background: #f5f5f5; padding: 10px; min-height: 100px; }
  </style>
</head>
<body>
  <h1>Test Harness — simula botão do Help Desk</h1>
  <p>Clica no botão abaixo. O handler simula o app Dojo mudando o hash:</p>
  <span id="homepage.pane.panel_refreshIcon" title="Atualizar">Atualizar</span>

  <div id="log"></div>

  <script>
    const logEl = document.getElementById("log");
    function log(msg) {
      logEl.textContent += new Date().toLocaleTimeString("pt-BR") + " — " + msg + "\n";
    }

    const btn = document.getElementById("homepage.pane.panel_refreshIcon");
    btn.addEventListener("click", () => {
      log("CLIQUE detectado no botão.");
      // Simula o app mudando o hash, como o Help Desk real faz.
      setTimeout(() => {
        location.hash = "welcome%2FWelcomeDispatchAction.do?dispatch=refresh";
        log("Hash atualizado para dispatch=refresh.");
      }, 100);
    });

    log("Harness pronto. Abre a popup da extensão e ativa.");
  </script>
</body>
</html>
```

- [ ] **Step 2: Verify the harness runs standalone**

Open `test/harness.html` directly in the browser (double-click). Click the blue "Atualizar" span. Confirm:
- Console/log area shows "CLIQUE detectado no botão."
- URL hash becomes `#welcome%2FWelcomeDispatchAction.do?dispatch=refresh`.
- Log shows "Hash atualizado para dispatch=refresh."

If the click does not fire, the element's ID with dots requires escaping in `getElementById` — but `getElementById` treats the argument as a literal string, so no escaping is needed. Verify by typing in DevTools console: `document.getElementById("homepage.pane.panel_refreshIcon")` returns the span.

- [ ] **Step 3: Commit**

```bash
git add test/harness.html
git commit -m "test: add standalone harness mimicking Help Desk button + hash"
```

---

## Task 3: content.js — click + hash confirmation (core cycle)

Implements the heart of the extension. No timer yet (Task 4 adds it). This task makes `refreshTick()` work and exposes it on `window` so the harness can trigger it for manual testing.

**Files:**
- Create: `content.js`

**Interfaces:**
- Consumes: `BUTTON_ID`, `REFRESH_HASH_MARKER`, `REFRESH_CONFIRM_TIMEOUT_MS`, `STORAGE_KEYS` (from `config.js`).
- Produces (internal to the content-script context, but documented for Task 4/5):
  - `function refreshTick(): Promise<void>` — finds button, clicks (with ancestor fallback), awaits hash confirmation, writes `lastUpdate`/`lastStatus` to storage.
  - `async function waitRefreshConfirmation(): Promise<boolean>` — resolves `true` if hash changes to include marker within timeout, else `false`.
  - `function findClickable(): Element | null` — returns the button or its closest clickable ancestor.

- [ ] **Step 1: Create `content.js` with the core cycle**

```javascript
"use strict";

// ---- DOM lookup ----------------------------------------------------------
// Procura o botão pelo ID estável. Fallback: ancestral clicável (Dojo/Dijit
// amarra o evento no <button>/<span role=button> pai do ícone).
function findClickable() {
  const el = document.getElementById(BUTTON_ID);
  if (!el) return null;
  return el.closest("button, [role='button'], .dijitButton") || el;
}

// ---- Hash confirmation ---------------------------------------------------
// Promise não-bloqueante: resolve true se o hash mudar para incluir o marker
// dentro do timeout; false caso contrário.
function waitRefreshConfirmation() {
  return new Promise((resolve) => {
    const before = location.hash;
    const onChange = () => {
      if (location.hash.includes(REFRESH_HASH_MARKER) && location.hash !== before) {
        cleanup();
        resolve(true);
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, REFRESH_CONFIRM_TIMEOUT_MS);
    function cleanup() {
      clearTimeout(timer);
      window.removeEventListener("hashchange", onChange);
    }
    window.addEventListener("hashchange", onChange);
  });
}

// ---- Storage helper ------------------------------------------------------
function setStatus(status, updateTimestamp) {
  const obj = { [STORAGE_KEYS.lastStatus]: status };
  if (updateTimestamp !== undefined) obj[STORAGE_KEYS.lastUpdate] = updateTimestamp;
  try {
    chrome.storage.sync.set(obj);
  } catch (e) {
    console.warn("[HD-AutoRefresh] storage.set falhou:", e);
  }
}

// ---- Core tick -----------------------------------------------------------
async function refreshTick() {
  const clickable = findClickable();
  if (!clickable) {
    setStatus("waiting");
    console.log("[HD-AutoRefresh] Botão não encontrado — aguardando.");
    return;
  }
  try {
    clickable.click();
  } catch (e) {
    console.warn("[HD-AutoRefresh] click() lançou:", e);
    setStatus("waiting");
    return;
  }
  const confirmed = await waitRefreshConfirmation();
  if (confirmed) {
    setStatus("confirmed", Date.now());
    console.log("[HD-AutoRefresh] Refresh confirmado.");
  } else {
    setStatus("noResponse");
    console.warn("[HD-AutoRefresh] Clique não produziu mudança de hash.");
  }
}

// Exposto para teste manual via console e via Task 3 Step 2.
window.__hdRefreshTick = refreshTick;
console.log("[HD-AutoRefresh] content.js carregado. window.__hdRefreshTick() disponível para teste.");
```

- [ ] **Step 2: Load the extension and verify the core cycle on the harness**

To test the content script against `file://`, temporarily widen `matches` is NOT allowed (file:// matching needs extra setup). Instead, use the real injection path on a served page. Simplest: use the harness served over a local HTTP server so the `matches` pattern (temporarily adjusted) injects the script.

Procedure:
1. In `manifest.json`, temporarily change `matches` to `["http://localhost:8000/*"]`. (Revert in Step 4.)
2. Serve the test dir: `python -m http.server 8000` (or `npx http-server -p 8000`) from the project root.
3. Load the extension: `chrome://extensions` → toggle "Modo do desenvolvedor" → "Carregar sem compactação" → select project root.
4. Open `http://localhost:8000/test/harness.html`.
5. Open DevTools console on that page. Confirm the log line `[HD-AutoRefresh] content.js carregado...` appears.
6. In console, run: `window.__hdRefreshTick()`. Confirm:
   - Harness log shows "CLIQUE detectado no botão." then "Hash atualizado para dispatch=refresh."
   - Console shows "[HD-AutoRefresh] Refresh confirmado."
7. In another tab, open `chrome://extensions` → click "Service worker" / "Inspecionar" is N/A (no background). To check storage: open the extension's popup won't exist yet (Task 5). Instead, DevTools → Application → Storage → Extension storage, OR run in the harness console:
   `chrome.storage.sync.get(null, console.log)` — confirm `hd_lastStatus === "confirmed"` and `hd_lastUpdate` is a recent timestamp.

- [ ] **Step 3: Test the "no button" path**

In the harness page DevTools console, run:
```javascript
document.getElementById("homepage.pane.panel_refreshIcon").remove();
window.__hdRefreshTick();
```
Confirm console shows `[HD-AutoRefresh] Botão não encontrado — aguardando.` and `chrome.storage.sync.get(null, console.log)` shows `hd_lastStatus === "waiting"`. Re-add is not needed for further tasks.

- [ ] **Step 4: Revert `matches` to the placeholder domain**

Change `manifest.json` `matches` back to:
```json
"matches": ["https://meu-helpdesk.exemplo.com.br/*/application.do*"],
```
Reload the extension on `chrome://extensions` (click the reload arrow).

- [ ] **Step 5: Commit**

```bash
git add content.js manifest.json
git commit -m "feat(content): add click + hash-confirmation core cycle"
```

---

## Task 4: content.js — timer lifecycle and storage sync

Wraps `refreshTick()` from Task 3 in a managed `setInterval`, driven by `chrome.storage`. Reacts to config changes via `storage.onChanged`. Prevents duplicate timers.

**Files:**
- Modify: `content.js` (append timer-management code)

**Interfaces:**
- Consumes: `DEFAULT_INTERVAL_MIN`, `DEFAULT_ACTIVE`, `STORAGE_KEYS` (from `config.js`); `refreshTick()` (from Task 3).
- Produces: a running timer that starts/stops based on `hd_active` and reschedules on `hd_intervalMin` change. No new exports needed beyond the existing `window.__hdRefreshTick`.

- [ ] **Step 1: Append timer lifecycle to `content.js`**

Add at the end of `content.js`:

```javascript
// ---- Timer lifecycle -----------------------------------------------------
let intervalId = null;
let currentIntervalMin = DEFAULT_INTERVAL_MIN;

function startTimer() {
  stopTimer();
  intervalId = setInterval(refreshTick, currentIntervalMin * 60000);
  console.log("[HD-AutoRefresh] Timer iniciado: a cada", currentIntervalMin, "min.");
}

function stopTimer() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[HD-AutoRefresh] Timer parado.");
  }
}

function applyConfig(cfg) {
  const active = cfg[STORAGE_KEYS.active] ?? DEFAULT_ACTIVE;
  currentIntervalMin = cfg[STORAGE_KEYS.intervalMin] ?? DEFAULT_INTERVAL_MIN;
  if (active) startTimer();
  else stopTimer();
}

// ---- Boot ----------------------------------------------------------------
chrome.storage.sync.get(Object.values(STORAGE_KEYS), (cfg) => {
  applyConfig(cfg);
});

// ---- React to config changes from popup ----------------------------------
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  const relevant = {};
  let changed = false;
  for (const key of [STORAGE_KEYS.active, STORAGE_KEYS.intervalMin]) {
    if (changes[key]) { relevant[key] = changes[key].newValue; changed = true; }
  }
  if (changed) {
    chrome.storage.sync.get(Object.values(STORAGE_KEYS), applyConfig);
  }
});

// ---- React to "refresh now" from popup -----------------------------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "refreshNow") {
    refreshTick();
    sendResponse({ ok: true });
  }
  return true; // async response
});
```

- [ ] **Step 2: Verify timer starts/stops via storage on the harness**

Re-apply the Task 3 Step 2 test setup (temporarily `matches` → `["http://localhost:8000/*"]`, local server, reload extension, open harness URL). Then:

1. Confirm on harness load, console shows `[HD-AutoRefresh] Timer parado.` only if default inactive — actually default `DEFAULT_ACTIVE = false`, so expect NO "Timer iniciado" on load (timer starts only when active). Verify console does NOT show "Timer iniciado" yet.
2. In harness DevTools console, activate:
   ```javascript
   chrome.storage.sync.set({ hd_active: true, hd_intervalMin: 1 });
   ```
   Confirm console shows "Timer iniciado: a cada 1 min."
3. Wait — within ~60s the harness log should show an automatic refresh cycle ("CLIQUE detectado no botão." + "Hash atualizado"). For faster verification, instead set `hd_intervalMin` to `1` and also confirm manual tick still works via `window.__hdRefreshTick()`.
4. Deactivate:
   ```javascript
   chrome.storage.sync.set({ hd_active: false });
   ```
   Confirm console shows "Timer parado."
5. Reactivate then change interval:
   ```javascript
   chrome.storage.sync.set({ hd_active: true });
   // then
   chrome.storage.sync.set({ hd_intervalMin: 2 });
   ```
   Confirm console shows "Timer parado." then "Timer iniciado: a cada 2 min." (proves no duplicate timer — only one "iniciado" line per change).
6. Test message-driven refresh:
   ```javascript
   chrome.runtime.sendMessage({ type: "refreshNow" }, console.log);
   ```
   Confirm harness log shows a click cycle and the callback logs `{ok: true}`.

- [ ] **Step 3: Revert `matches` and reload**

`matches` back to `["https://meu-helpdesk.exemplo.com.br/*/application.do*"]`. Reload extension.

- [ ] **Step 4: Commit**

```bash
git add content.js manifest.json
git commit -m "feat(content): add timer lifecycle, storage sync, refreshNow message"
```

---

## Task 5: popup.html and styles.css

Static structure + presentation. No logic.

**Files:**
- Create: `popup.html`
- Create: `styles.css`

**Interfaces:**
- Produces: DOM elements with IDs that `popup.js` (Task 6) will wire:
  - `#statusText`, `#intervalText`, `#lastUpdateText`, `#nextUpdateText` (status display)
  - `#activeToggle` (checkbox), `#intervalSelect` (select), `#customInterval` (number input, hidden by default), `#refreshNowBtn` (button), `#hint` (validation message).

- [ ] **Step 1: Create `popup.html`**

```html
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header>
    <h1>Help Desk Auto-Refresh</h1>
  </header>

  <section class="status-box">
    <div class="status-row"><span>Status:</span> <strong id="statusText">—</strong></div>
    <div class="status-row"><span>Intervalo:</span> <span id="intervalText">—</span></div>
    <div class="status-row"><span>Última atualização:</span> <span id="lastUpdateText">—</span></div>
    <div class="status-row"><span>Próxima atualização:</span> <span id="nextUpdateText">—</span></div>
  </section>

  <section class="controls">
    <label class="switch">
      <input type="checkbox" id="activeToggle">
      <span>Atualização automática</span>
    </label>

    <label for="intervalSelect">Intervalo</label>
    <select id="intervalSelect">
      <option value="1">1 minuto</option>
      <option value="2">2 minutos</option>
      <option value="5">5 minutos</option>
      <option value="10">10 minutos</option>
      <option value="15">15 minutos</option>
      <option value="30">30 minutos</option>
      <option value="custom">Personalizado...</option>
    </select>
    <input type="number" id="customInterval" min="1" placeholder="min" hidden>

    <button id="refreshNowBtn">Atualizar agora</button>
  </section>

  <footer>
    <p id="hint"></p>
  </footer>

  <script src="config.js"></script>
  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create `styles.css`**

```css
:root {
  --bg: #ffffff;
  --fg: #1f2937;
  --muted: #6b7280;
  --accent: #1a73e8;
  --border: #e5e7eb;
  --row-bg: #f9fafb;
}

* { box-sizing: border-box; }

body {
  width: 280px;
  margin: 0;
  font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  color: var(--fg);
  background: var(--bg);
}

header {
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}

header h1 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.status-box {
  padding: 8px 12px;
  background: var(--row-bg);
  border-bottom: 1px solid var(--border);
}

.status-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 0;
}

.status-row > span:first-child {
  color: var(--muted);
}

#statusText,
#lastUpdateText,
#nextUpdateText,
#intervalText {
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
  font-size: 12px;
}

#statusText[data-state="confirmed"] { color: #15803d; }
#statusText[data-state="waiting"]   { color: #b45309; }
#statusText[data-state="noResponse"]{ color: #b91c1c; }

.controls {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
}

.switch {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

#intervalSelect,
#customInterval,
#refreshNowBtn {
  width: 100%;
  padding: 6px 8px;
  font-size: 13px;
}

#customInterval { display: block; }

#refreshNowBtn {
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

#refreshNowBtn:hover { filter: brightness(0.95); }

footer {
  padding: 6px 12px 10px;
}

#hint {
  margin: 0;
  min-height: 16px;
  font-size: 11px;
  color: #b91c1c;
}
```

- [ ] **Step 3: Verify popup renders (styling only, logic comes in Task 6)**

Temporarily: in `manifest.json`, the `action.default_popup` already points to `popup.html`. Reload the extension. Click the extension's toolbar icon. Confirm:
- Popup opens, ~280px wide.
- Header "Help Desk Auto-Refresh" visible.
- Status box shows 4 rows with em-dashes.
- Toggle unchecked, select shows "1 minuto", custom input hidden, blue "Atualizar agora" button visible.
- No console errors in the popup's DevTools (right-click popup → "Inspecionar").

- [ ] **Step 4: Commit**

```bash
git add popup.html styles.css
git commit -m "feat(popup): add popup structure and styling"
```

---

## Task 6: popup.js — wire controls and render status

Reads/writes `chrome.storage.sync`, wires all controls, renders status, listens to `storage.onChanged`.

**Files:**
- Create: `popup.js`

**Interfaces:**
- Consumes: `STORAGE_KEYS`, `DEFAULT_ACTIVE`, `DEFAULT_INTERVAL_MIN`, `MIN_INTERVAL_MIN` (from `config.js`).
- Produces: a self-contained popup controller. Writes `hd_active` and `hd_intervalMin`; reads all four storage keys to render status.

- [ ] **Step 1: Create `popup.js`**

```javascript
"use strict";

const els = {
  status:      document.getElementById("statusText"),
  interval:    document.getElementById("intervalText"),
  lastUpdate:  document.getElementById("lastUpdateText"),
  nextUpdate:  document.getElementById("nextUpdateText"),
  active:      document.getElementById("activeToggle"),
  intervalSel: document.getElementById("intervalSelect"),
  custom:      document.getElementById("customInterval"),
  refreshNow:  document.getElementById("refreshNowBtn"),
  hint:        document.getElementById("hint"),
};

function formatTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("pt-BR");
}

// ---- Render status from storage -------------------------------------------
function render(cfg) {
  const active     = cfg[STORAGE_KEYS.active] ?? DEFAULT_ACTIVE;
  const intervalMin = cfg[STORAGE_KEYS.intervalMin] ?? DEFAULT_INTERVAL_MIN;
  const lastUpdate = cfg[STORAGE_KEYS.lastUpdate];
  const lastStatus = cfg[STORAGE_KEYS.lastStatus];

  // Active toggle + interval select
  els.active.checked = active;
  const preset = ["1", "2", "5", "10", "15", "30"].includes(String(intervalMin));
  if (preset) {
    els.intervalSel.value = String(intervalMin);
    els.custom.hidden = true;
  } else {
    els.intervalSel.value = "custom";
    els.custom.hidden = false;
    els.custom.value = String(intervalMin);
  }

  // Status text + color state
  let label, state;
  if (!active) {
    label = "Pausado"; state = "";
  } else if (lastStatus === "confirmed") {
    label = "Ativo"; state = "confirmed";
  } else if (lastStatus === "waiting") {
    label = "Aguardando Help Desk"; state = "waiting";
  } else if (lastStatus === "noResponse") {
    label = "Botão não respondeu"; state = "noResponse";
  } else {
    label = "Ativo"; state = ""; // active but no tick yet
  }
  els.status.textContent = label;
  els.status.dataset.state = state;

  // Interval / times
  els.interval.textContent = intervalMin + " min";
  els.lastUpdate.textContent = formatTime(lastUpdate);
  els.nextUpdate.textContent =
    lastUpdate && active ? formatTime(lastUpdate + intervalMin * 60000) : "—";
}

// ---- Storage I/O ----------------------------------------------------------
function load() {
  chrome.storage.sync.get(Object.values(STORAGE_KEYS), render);
}

function saveActive(value) {
  chrome.storage.sync.set({ [STORAGE_KEYS.active]: value });
}

function saveInterval(minutes) {
  if (!Number.isFinite(minutes) || minutes < MIN_INTERVAL_MIN) {
    els.hint.textContent = "Intervalo mínimo: " + MIN_INTERVAL_MIN + " minuto(s).";
    return false;
  }
  els.hint.textContent = "";
  chrome.storage.sync.set({ [STORAGE_KEYS.intervalMin]: minutes });
  return true;
}

// ---- Wire controls --------------------------------------------------------
els.active.addEventListener("change", () => {
  saveActive(els.active.checked);
});

els.intervalSel.addEventListener("change", () => {
  if (els.intervalSel.value === "custom") {
    els.custom.hidden = false;
    els.custom.focus();
  } else {
    els.custom.hidden = true;
    saveInterval(Number(els.intervalSel.value));
  }
});

els.custom.addEventListener("change", () => {
  saveInterval(Number(els.custom.value));
});

els.refreshNow.addEventListener("click", () => {
  // Broadcast: any content script listening runs refreshTick().
  chrome.runtime.sendMessage({ type: "refreshNow" }, () => {
    // Storage will update via onChanged; close popup for visual feedback.
    if (chrome.runtime.lastError) {
      els.hint.textContent = "Nenhuma aba do Help Desk ativa.";
    } else {
      els.hint.textContent = "Atualização solicitada.";
    }
  });
});

// ---- Live updates while popup is open -------------------------------------
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync") load();
});

load();
```

- [ ] **Step 2: Verify full popup flow against the harness**

Re-apply the Task 3 Step 2 test setup (`matches` → `["http://localhost:8000/*"]`, local server, reload extension). Open `http://localhost:8000/test/harness.html`. Then click the extension toolbar icon to open the popup.

1. Initial render: toggle unchecked, status "Pausado", select "1 minuto", last/next update "—".
2. Toggle ON → status becomes "Ativo" (or "Aguardando Help Desk" if no tick yet). Check harness DevTools console shows "Timer iniciado: a cada 1 min."
3. Select "2 minutos" → harness console shows timer reschedule; popup "Intervalo:" row shows "2 min".
4. Select "Personalizado..." → custom input appears. Enter `3`, blur/Enter → "Intervalo:" shows "3 min"; harness shows reschedule to 3 min.
5. Enter `0` in custom → hint shows "Intervalo mínimo: 1 minuto(s)."; storage unchanged (verify `chrome.storage.sync.get(null, console.log)` still shows previous interval).
6. Click "Atualizar agora" → hint shows "Atualização solicitada."; harness log shows a click cycle; within ~2s popup "Última atualização" updates to current time, "Próxima" shows +interval ahead.
7. Click toggle OFF → status "Pausado", "Próxima atualização" becomes "—".

- [ ] **Step 3: Verify persistence across popup close/reopen**

With toggle ON and interval 2 min, close the popup, reopen it. Confirm state restored (toggle ON, "2 min", last/next times present).

- [ ] **Step 4: Revert `matches` and reload**

`matches` back to `["https://meu-helpdesk.exemplo.com.br/*/application.do*"]`. Reload extension.

- [ ] **Step 5: Commit**

```bash
git add popup.js manifest.json
git commit -m "feat(popup): wire controls, render status, live storage sync"
```

---

## Task 7: Icons

The manifest references `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png`. Without them, Chrome shows a generic puzzle-piece icon and logs a warning on load. Provide simple PNG icons.

**Files:**
- Create: `icons/icon16.png`
- Create: `icons/icon48.png`
- Create: `icons/icon128.png`

- [ ] **Step 1: Generate three PNG icons**

Options (pick one):
- **A. Reuse an existing asset:** if the user has a logo, copy/resize to 16×16, 48×48, 128×128 PNG.
- **B. Generate with ImageMagick** (if installed): a circular blue refresh arrow proxy — a filled circle with a white arrow. Run:
  ```bash
  mkdir -p icons
  for size in 16 48 128; do
    convert -size ${size}x${size} xc:none \
      -fill "#1a73e8" -draw "circle $((size/2)),$((size/2)) $((size/2)),0" \
      -fill white -gravity center -pointsize $((size/2)) -annotate +0+0 "↻" \
      icons/icon${size}.png
  done
  ```
- **C. Hand-draw in an editor:** any 16/48/128 PNG. A solid colored square is acceptable as a placeholder.

If none of A/B/C is available in the environment, create minimal valid PNGs via a tiny Node script:
```bash
node -e "
const fs=require('fs');
function png(n){const c=require('zlib').deflateSyncSync?null:null;// placeholder
// simplest: write a 1x1 PNG scaled by browser is NOT acceptable; use ImageMagick instead.
}
" 2>/dev/null || echo "Use option B (ImageMagick) or supply PNGs manually."
```
(If ImageMagick is unavailable and no asset exists, stop and ask the user to drop a 128×128 PNG into `icons/`, then derive 16 and 48 from it.)

- [ ] **Step 2: Verify icons are valid PNGs at correct sizes**

Run:
```bash
file icons/icon16.png icons/icon48.png icons/icon128.png 2>/dev/null || ls -la icons/
```
Expected: each file exists, non-empty, reports as PNG image data with dimensions matching 16, 48, 128 respectively (ImageMagick `identify icons/*.png` if available).

- [ ] **Step 3: Verify in browser**

Reload the extension on `chrome://extensions`. Confirm:
- The extension's icon on the card is the custom icon (not a puzzle piece).
- The toolbar icon (pin it if hidden) shows the custom icon.
- No "Could not load icon" warnings on the extensions page.

- [ ] **Step 4: Commit**

```bash
git add icons/
git commit -m "feat: add toolbar/extension icons (16/48/128)"
```

---

## Task 8: End-to-end smoke test and README

Final validation against the spec's manual test list, plus a short README for install/config.

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create `README.md`**

````markdown
# Help Desk Auto-Refresh

Extensão Chrome/Edge (Manifest V3) que clica automaticamente no botão **Atualizar** do Help Desk em intervalos definidos, sem recarregar a página.

## Instalação

1. Abrir `chrome://extensions` (ou `edge://extensions`).
2. Ativar **Modo do desenvolvedor**.
3. Clicar **Carregar sem compactação** e selecionar a pasta do projeto.
4. Fixar o ícone na barra de ferramentas.

## Configurar o domínio do Help Desk

O domínio é fixo (a extensão não pede acesso a outros sites). Para apontar ao seu Help Desk:

1. Editar `manifest.json`, linha `matches` dentro de `content_scripts`:
   ```json
   "matches": ["https://meu-helpdesk.exemplo.com.br/*/application.do*"]
   ```
   Substituir pelo domínio real. O padrão precisa casar com a URL onde o botão aparece.
2. Editar `config.js`, constante `HELPDESK_URL`, para o mesmo valor (usado para documentação/consistência).
3. Em `chrome://extensions`, clicar no botão **Atualizar** (setinha circular) da extensão para recarregar.

## Uso

- Clicar no ícone da extensão com a aba do Help Desk aberta.
- Marcar **Atualização automática**.
- Escolher o intervalo (1, 2, 5, 10, 15, 30 min, ou personalizado ≥ 1 min).
- **Atualizar agora** força um ciclo imediato (útil para testar).

## Estados do status

- **Ativo** — clicou e o Help Desk confirmou o refresh (hash mudou para `dispatch=refresh`).
- **Aguardando Help Desk** — botão não encontrado na página (aguarda o próximo ciclo).
- **Botão não respondeu** — clicou mas o hash não mudou dentro de 2s.
- **Pausado** — automação desativada.

## Segurança

- Sem acesso a outros sites além do declarado em `matches`.
- Sem rede externa, sem coleta de dados, sem mutação de conteúdo além do clique.
- Configurações persistem via `chrome.storage.sync`.
````

- [ ] **Step 2: Run the full spec smoke-test checklist**

With the real Help Desk domain configured in `matches` and `config.js`, reload the extension and verify each item from the spec's test section:

- [ ] Carregar extensão em `chrome://extensions` (Modo do desenvolvedor → Carregar sem compactação).
- [ ] Abrir Help Desk → console mostra `[HD-AutoRefresh] content.js carregado...`.
- [ ] Popup: ativar → status "Ativo".
- [ ] Botão "Atualizar agora" → clique dispara, hash muda, `lastUpdate` atualiza.
- [ ] Simular botão sumindo (DevTools deletar elemento) → status "Aguardando Help Desk".
- [ ] Trocar intervalo → timer recria sem duplicar (console: "parado" + "iniciado" uma vez).
- [ ] Fechar/reabrir navegador → config persiste (toggle e intervalo restaurados).
- [ ] Reabrir popup → estado correto.

If the real Help Desk domain is not yet known, run the same checklist against the harness (`test/harness.html`) using the temporary `matches` → `["http://localhost:8000/*"]` procedure from Task 3 Step 2, then revert.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add README (install, domain config, usage, smoke test)"
```

---

## Self-Review

**Spec coverage:**
- Req #1 (config interval) → Task 5 (select) + Task 6 (`saveInterval`, custom). ✓
- Req #2 (ativar/desativar persistente) → Task 6 (`saveActive` + `storage.sync`) + Task 4 (`applyConfig` reads on boot). ✓
- Req #3 (click no botão, sem reload) → Task 3 (`clickable.click()`). ✓
- Req #4 (SPA dinâmico resiliente) → Task 3 (`findClickable` returns null → `waiting`) + Task 4 (re-busca a cada tick). ✓
- Req #5 (indicador de status) → Task 5 (status box) + Task 6 (`render`). ✓
- Req #6 (restrição domínio) → Task 1 (`matches` fixo) — global constraint. ✓
- Req #7 (segurança) → Global Constraints + Task 3 (no `location.reload`, no external calls). ✓

**Placeholder scan:** Task 7 icons has a documented fallback chain (ImageMagick / existing asset / ask user). No "TBD". All code blocks complete.

**Type consistency:** `STORAGE_KEYS` keys (`active`, `intervalMin`, `lastUpdate`, `lastStatus`) used identically across Task 1 (definition), Task 3 (`setStatus`), Task 4 (`applyConfig`, `onChanged`), Task 6 (`render`, `saveActive`, `saveInterval`). `refreshTick` signature consistent Task 3 → Task 4. `refreshNow` message type consistent Task 4 (listener) → Task 6 (sender). ✓
