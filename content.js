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
