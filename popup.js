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

function formatInterval(sec) {
  return sec < 60 ? sec + " s" : sec / 60 + " min";
}

// ---- Render status from storage -------------------------------------------
function render(cfg) {
  const active     = cfg[STORAGE_KEYS.active] ?? DEFAULT_ACTIVE;
  const intervalSec = cfg[STORAGE_KEYS.intervalSec] ?? DEFAULT_INTERVAL_SEC;
  const lastUpdate = cfg[STORAGE_KEYS.lastUpdate];
  const lastStatus = cfg[STORAGE_KEYS.lastStatus];

  // Active toggle + interval select
  els.active.checked = active;
  const preset = ["15", "30", "60", "120", "300", "600", "900", "1800"].includes(String(intervalSec));
  if (preset) {
    els.intervalSel.value = String(intervalSec);
    els.custom.hidden = true;
  } else {
    els.intervalSel.value = "custom";
    els.custom.hidden = false;
    els.custom.value = String(intervalSec);
  }

  // Status text + color state
  let label, state;
  if (!active) {
    label = "Pausado"; state = "";
  } else if (lastStatus === "confirmed") {
    label = "Ativo"; state = "confirmed";
  } else if (lastStatus === "waiting") {
    label = "Aguardando Assyst"; state = "waiting";
  } else if (lastStatus === "noResponse") {
    label = "Botão não respondeu"; state = "noResponse";
  } else {
    label = "Ativo"; state = ""; // active but no tick yet
  }
  els.status.textContent = label;
  els.status.dataset.state = state;

  // Interval / times
  els.interval.textContent = formatInterval(intervalSec);
  els.lastUpdate.textContent = formatTime(lastUpdate);
  els.nextUpdate.textContent =
    lastUpdate && active ? formatTime(lastUpdate + intervalSec * 1000) : "—";
}

// ---- Storage I/O ----------------------------------------------------------
function load() {
  chrome.storage.local.get(Object.values(STORAGE_KEYS), render);
}

function saveActive(value) {
  chrome.storage.local.set({ [STORAGE_KEYS.active]: value });
}

function saveInterval(seconds) {
  if (!Number.isFinite(seconds) || seconds < MIN_INTERVAL_SEC) {
    els.hint.textContent = "Intervalo mínimo: " + MIN_INTERVAL_SEC + " segundo(s).";
    return false;
  }
  els.hint.textContent = "";
  chrome.storage.local.set({ [STORAGE_KEYS.intervalSec]: seconds });
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
  chrome.storage.local.set({ [STORAGE_KEYS.refreshNonce]: Date.now() });
  els.hint.textContent = "Atualização solicitada.";
});

// ---- Live updates while popup is open -------------------------------------
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") load();
});

migrateIntervalStorage();
load();
