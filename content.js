"use strict";

// ---- DOM lookup ----------------------------------------------------------
// Procura o botão "Atualizar". Estratégia resiliente em ordem:
//  1. Por ID (fallback — getElementById trata o id como string literal).
//  2. aria-labelledby referencia o id do refreshIcon (estável no Dojo/Dijit).
//  3. role=button + title="Atualizar" (confirmado funcional no assyst real).
// Em alguns DOMs do assyst o seletor CSS "#id.com.pontos" falha; por isso
// os seletores abaixo evitam o "#id" e usam atributos estruturais.
function findClickable() {
  let el =
    document.getElementById(BUTTON_ID) ||
    document.querySelector('[aria-labelledby$="refreshIcon_label"][role="button"]') ||
    document.querySelector('[role="button"][title="Atualizar"]');
  if (!el) return null;
  return el.closest("button, [role='button'], .dijitButton") || el;
}

// ---- Storage helper ------------------------------------------------------
// "Extension context invalidated" acontece quando a extensão é recarregada/
// removida enquanto a aba estava aberta: o content script órfão perde o acesso
// ao chrome.storage. Nesse caso, silenciamos (o refresh pode ainda funcionar,
// só não conseguimos atualizar o status no popup).
function isContextValid() {
  try {
    return typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id;
  } catch {
    return false;
  }
}

function setStatus(status, updateTimestamp) {
  if (!isContextValid()) return;
  const obj = { [STORAGE_KEYS.lastStatus]: status };
  if (updateTimestamp !== undefined) obj[STORAGE_KEYS.lastUpdate] = updateTimestamp;
  try {
    chrome.storage.local.set(obj);
  } catch (e) {
    // Contexto invalidado entre a checagem e o set — silencioso.
  }
}

// ---- Core tick -----------------------------------------------------------
// Refresh = clicou no botão (que existe). O assyst não muda o hash em refreshs
// repetidos, então o hash não é indicador confiável de sucesso — consideramos
// o refresh confirmado assim que o clique dispara sem erro.
function refreshTick() {
  const clickable = findClickable();
  if (!clickable) {
    setStatus("waiting");
    console.log("[HD-AutoRefresh] Botão não encontrado — aguardando.");
    return;
  }
  try {
    clickable.click();
    setStatus("confirmed", Date.now());
    console.log("[HD-AutoRefresh] Refresh disparado.");
  } catch (e) {
    console.warn("[HD-AutoRefresh] click() lançou:", e);
    setStatus("waiting");
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
  const raw = Number(cfg[STORAGE_KEYS.intervalMin]);
  currentIntervalMin = Number.isFinite(raw) && raw >= MIN_INTERVAL_MIN ? raw : DEFAULT_INTERVAL_MIN;
  if (active) startTimer();
  else stopTimer();
}

// ---- Boot ----------------------------------------------------------------
chrome.storage.local.get(Object.values(STORAGE_KEYS), (cfg) => {
  applyConfig(cfg);
});

// ---- React to config changes from popup ----------------------------------
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  let nonce = false, config = false;
  for (const key of [STORAGE_KEYS.active, STORAGE_KEYS.intervalMin, STORAGE_KEYS.refreshNonce]) {
    if (!changes[key]) continue;
    if (key === STORAGE_KEYS.refreshNonce) nonce = true;
    else config = true;
  }
  if (nonce) refreshTick();
  if (config) chrome.storage.local.get(Object.values(STORAGE_KEYS), applyConfig);
});
