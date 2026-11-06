// ============================================================
// CONFIGURAÇÃO — EDITAR AQUI
// ============================================================

// ID do botão "Atualizar" na interface do Assyst.
// Nota: "homePage" com P maiúsculo (case-sensitive).
const BUTTON_ID = "homePage.pane.panel_refreshIcon";

// Domínio/padrão do Assyst. DEVE bater com "matches" no manifest.json.
const ASSYST_URL = "https://portaldeservicostjpb.lanlink.com.br/assystweb/application.do*";

// Marcador no hash que confirma que o refresh foi processado pela aplicação.
const REFRESH_HASH_MARKER = "dispatch=refresh";

// Tempo máximo (ms) esperando o hash mudar antes de marcar "não respondeu".
const REFRESH_CONFIRM_TIMEOUT_MS = 2000;

// Intervalo padrão (segundos) na primeira execução.
const DEFAULT_INTERVAL_SEC = 60;

// Intervalo mínimo permitido (segundos). Piso baixo o suficiente para
// atualizações em segundos sem inundar o servidor do Assyst de requests.
const MIN_INTERVAL_SEC = 5;

// Estado ativo por padrão.
const DEFAULT_ACTIVE = true;

// Chaves de storage.
const STORAGE_KEYS = {
  active: "hd_active",
  intervalSec: "hd_intervalSec",
  lastUpdate: "hd_lastUpdate",
  lastStatus: "hd_lastStatus", // "confirmed" | "noResponse" | "waiting"
  refreshNonce: "hd_refreshNonce", // monotônico: popup grava Date.now() para disparar refresh imediato
};

// Migração: versões antigas gravavam minutos em "hd_intervalMin".
// Converte para segundos e remove a chave antiga. Idempotente.
function migrateIntervalStorage() {
  chrome.storage.local.get(["hd_intervalMin", STORAGE_KEYS.intervalSec], (cfg) => {
    if (cfg.hd_intervalMin != null) {
      const update = {};
      if (cfg[STORAGE_KEYS.intervalSec] == null) {
        update[STORAGE_KEYS.intervalSec] = cfg.hd_intervalMin * 60;
      }
      chrome.storage.local.set(update);
      chrome.storage.local.remove("hd_intervalMin");
    }
  });
}
// ============================================================
