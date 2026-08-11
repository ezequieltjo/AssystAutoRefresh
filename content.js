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
