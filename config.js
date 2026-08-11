// ============================================================
// CONFIGURAÇÃO — EDITAR AQUI
// ============================================================

// ID do botão "Atualizar" na interface do Help Desk.
// Nota: "homePage" com P maiúsculo (case-sensitive).
const BUTTON_ID = "homePage.pane.panel_refreshIcon";

// Domínio/padrão do Help Desk. DEVE bater com "matches" no manifest.json.
const HELPDESK_URL = "https://portaldeservicostjpb.lanlink.com.br/assystweb/application.do*";

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
  refreshNonce: "hd_refreshNonce", // monotônico: popup grava Date.now() para disparar refresh imediato
};
// ============================================================
