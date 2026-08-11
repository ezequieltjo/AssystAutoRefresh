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
  chrome.storage.sync.set({ [STORAGE_KEYS.refreshNonce]: Date.now() });
  els.hint.textContent = "Atualização solicitada.";
});

// ---- Live updates while popup is open -------------------------------------
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync") load();
});

load();
