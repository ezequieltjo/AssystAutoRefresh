# Design — Extensão Help Desk Auto-Refresh

**Data:** 2026-08-11
**Status:** Aprovado (brainstorming)
**Alvo:** Google Chrome e Microsoft Edge, Manifest V3

## Objetivo

Automatizar a atualização da lista de chamados de um sistema de Help Desk que não atualiza sozinho, clicando no botão "Atualizar" da própria aplicação em intervalos definidos pelo usuário, sem recarregar a página inteira.

## Decisões de arquitetura (brainstorming)

1. **Múltiplas abas do Help Desk abertas:** como o timer vive no content script injetado em cada aba que casa com `matches`, cada aba do Help Desk aberta mantém sua própria lista atualizada independentemente. Não há coordenação entre abas (sem background service worker).
2. **Origem do timer:** `setInterval` no content script. Timer vive na aba Help Desk.
3. **Storage:** `chrome.storage.sync`.
4. **Intervalo mínimo:** 1 minuto. Piso técnico real (Chrome throttle de timers em background) é amigável a 1min+.
5. **Domínio:** fixo no `manifest.json` (`content_scripts.matches`). Sem permissão broad. Usuário não quer acesso a todos os sites.

## Arquitetura

```
manifest.json          # MV3, perms mínimas, matches = domínio fixo
config.js              # constantes (BUTTON_ID, defaults, STORAGE_KEYS)
content.js             # setInterval + click no botão + confirmação por hash
popup.html             # UI de configuração
popup.js               # lê/escreve storage, atualiza status
styles.css             # estilo do popup
icons/                 # icon16.png, icon48.png, icon128.png
```

Sem `background.js`. Sem service worker. Sem `chrome.alarms`. Sem `chrome.scripting`.

### Fluxo de dados

1. Content.js carrega na aba Help Desk em `document_idle`.
2. Lê config do storage (`active`, `intervalMin`).
3. Se `active`, cria `setInterval(refreshTick, intervalMin * 60000)`.
4. `refreshTick()`:
   - Busca `document.getElementById(BUTTON_ID)`. Se não existir, marca `lastStatus="waiting"` e retorna (não clica, não erro).
   - Se existir: anota `hashBefore = location.hash`, executa `.click()` (com fallback de ancestral).
   - Espera até `REFRESH_CONFIRM_TIMEOUT_MS` por `location.hash.includes(REFRESH_HASH_MARKER) && hash !== hashBefore`.
   - Confirmou → `lastStatus="confirmed"`, salva `lastUpdate=Date.now()`.
   - Timeout sem mudança → `lastStatus="noResponse"`.
5. `storage.onChanged` listener: se `active` ou `intervalMin` mudaram → limpa timer atual, recria conforme novo estado. Previne timers múltiplos.
6. Popup lê storage, mostra status. Reage a `storage.onChanged` em tempo real.

## manifest.json

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

**Onde editar o domínio:** linha `matches`. Único ponto. Trocar pelo domínio real exige recarregar a extensão (1 clique em "Atualizar" na página de extensões).

## config.js

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

## content.js

Responsabilidades:

1. Ao carregar: ler config storage. Se `active`, iniciar timer.
2. `setInterval(refreshTick, intervalMin * 60000)`.
3. `refreshTick()`: buscar botão, clicar (fallback ancestral), esperar confirmação de hash, salvar `lastUpdate`/`lastStatus`.
4. `storage.onChanged`: recriar timer se config mudou. Guarda `intervalId` global, `clearInterval` antes de recriar.
5. Fallback de ancestral: se `.click()` direto no `<span id>` não dispara evento Dojo/Dijit, tentar `.closest("button, [role='button'], .dijitButton")?.click()`.
6. Listener `chrome.runtime.onMessage` para `{type:"refreshNow"}` vindo do popup → força um `refreshTick()` imediato.

Prevenção de timers múltiplos:

```javascript
let intervalId = null;

function startTimer() {
  if (intervalId !== null) clearInterval(intervalId);
  intervalId = setInterval(refreshTick, currentIntervalMin * 60000);
}

function stopTimer() {
  if (intervalId !== null) { clearInterval(intervalId); intervalId = null; }
}
```

Confirmação de refresh via hash (Promise não-bloqueante):

```javascript
function waitRefreshConfirmation() {
  return new Promise((resolve) => {
    const before = location.hash;
    const onChange = () => {
      if (location.hash.includes(REFRESH_HASH_MARKER) && location.hash !== before) {
        clearTimeout(timer);
        window.removeEventListener("hashchange", onChange);
        resolve(true);
      }
    };
    window.addEventListener("hashchange", onChange);
    const timer = setTimeout(() => {
      window.removeEventListener("hashchange", onChange);
      resolve(false);
    }, REFRESH_CONFIRM_TIMEOUT_MS);
  });
}
```

## popup.html

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

## popup.js

Responsabilidades:

1. Ao abrir: ler storage → popular campos (`activeToggle.checked`, `intervalSelect.value`, textos de status).
2. `activeToggle.change` → salvar `active`.
3. `intervalSelect.change`:
   - Se "custom" → mostrar `customInterval`, usar valor dele.
   - Senão → esconder `customInterval`, usar valor do select.
   - Validar ≥ `MIN_INTERVAL_MIN`. Se inválido, erro no `hint`, não salvar.
   - Salvar `intervalMin`.
4. `refreshNowBtn.click` → `chrome.runtime.sendMessage({type:"refreshNow"})` (broadcast). Content scripts ativos escutam via `onMessage` e disparam `refreshTick()`. Evita necessidade de `tabs` permission ou `host_permissions` para filtrar abas por URL.
5. Atualizar status:
   - `statusText`: "Ativo" / "Pausado" / "Agregando Help Desk" / "Botão não respondeu" (baseado em `lastStatus` + `active`).
   - `lastUpdateText`: `formatTime(lastUpdate)` → `HH:MM:SS`.
   - `nextUpdateText`: `formatTime(lastUpdate + intervalMin*60000)`. Se pausado/sem `lastUpdate` → "—".
6. `storage.onChanged` listener → refresh dos campos em tempo real.

Helper:

```javascript
function formatTime(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString("pt-BR");
}
```

## styles.css

Popup compacto (~280px de largura), tipografia neutra, valores de status em fonte monospace para alinhar colunas. Sem dependências externas.

## Tratamento de erros e edge cases

- `chrome.storage` falha: try/catch nos reads/writes. Falha silenciosa + `console.warn`.
- `getElementById` retorna null: `lastStatus="waiting"`, não clica, não erro. Próximo tick tenta de novo.
- `.click()` lança exceção: try/catch em volta do clique. `lastStatus="error"`, próximo tick recupera.
- Timer correndo enquanto popup muda config: `storage.onChanged` limpa timer antigo antes de criar novo.
- Aba Help Desk recarregada (F5): content.js reinjeta via `document_idle`, relê storage, recria timer. Estado persiste.
- SPA muda rota sem recarregar: botão pode sumir/aparecer. Content.js re-busca a cada tick.
- "custom" sem valor digitado: não salva até valor válido (≥1).
- `hashchange` dispara por navegação não relacionada: só confirma se `hash.includes(REFRESH_HASH_MARKER) && hash !== before`. Falso positivo improvável.
- Throttle de timer em aba background: Chrome permite timers ≥1min sem throttling agressivo. `MIN_INTERVAL_MIN=1` garante isso.

## Segurança e restrições (mapeamento de requisitos)

| Req spec | Onde atendido |
|---|---|
| #1 Config intervalo | popup.html select + custom, storage.sync |
| #2 Ativar/desativar persistente | activeToggle, storage.sync, content.js lê onChanged |
| #3 Click no botão (sem reload) | `getElementById(BUTTON_ID).click()` |
| #4 SPA dinâmico resiliente | re-busca a cada tick, status "waiting" se sumir |
| #5 Indicador de status | popup status-box, 4 estados |
| #6 Restrição domínio | `matches` fixo no manifest, sem broad perms |
| #7 Segurança/comportamento | sem rede externa, sem coleta, timers únicos limpos |

Garantias de segurança:

- Sem `fetch`/`XHR` para hosts externos → só `chrome.storage` local.
- Sem leitura de DOM além do botão → não coleta chamados/usuários.
- Sem `location.reload()`, sem `window.open()`, sem novas abas.
- Sem mutação de conteúdo → só `.click()`.

## Testes (manuais, sem framework)

- Carregar extensão em `chrome://extensions` (Modo do desenvolvedor → Carregar sem compactação).
- Abrir Help Desk → verificar content.js injetou (console log de inicialização).
- Popup: ativar → status "Ativo".
- Botão "Atualizar agora" → ver clique + hash mudar + `lastUpdate` atualizar.
- Simular botão sumindo (DevTools deletar elemento) → status "Aguardando Help Desk".
- Trocar intervalo → timer recria sem duplicar.
- Fechar/reabrir navegador → config persiste.
- Reabrir popup → estado correto.

## Padrão de hash observado

URL base do Help Desk termina com `application.do`. Ao clicar no botão "Atualizar", o hash muda para incluir `#welcome%2FWelcomeDispatchAction.do?dispatch=refresh`.

Uso no design: indicador de status (confirmação de sucesso), **não** como mecanismo de atualização. Não tentar atualizar mudando `location.hash` direto — a aplicação (Dojo/Dijit) amarra estado interno ao evento do botão. Manter `.click()`.
