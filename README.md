# Assyst Auto-Refresh

Extensão Chrome/Edge (Manifest V3) que clica automaticamente no botão **Atualizar** do Assyst em intervalos definidos, sem recarregar a página.

## Instalação

1. Abrir `chrome://extensions` (ou `edge://extensions`).
2. Ativar **Modo do desenvolvedor**.
3. Clicar **Carregar sem compactação** e selecionar a pasta do projeto.
4. Fixar o ícone na barra de ferramentas.

## Configurar o domínio do Assyst

O domínio é fixo (a extensão não pede acesso a outros sites). Para apontar ao seu Assyst:

1. Editar `manifest.json`, linha `matches` dentro de `content_scripts`:
   ```json
   "matches": ["https://meu-assyst.exemplo.com.br/*/application.do*"]
   ```
   Substituir pelo domínio real. O padrão precisa casar com a URL onde o botão aparece.
2. Editar `config.js`, constante `ASSYST_URL`, para o mesmo valor (usado para documentação/consistência).
3. Em `chrome://extensions`, clicar no botão **Atualizar** (setinha circular) da extensão para recarregar.

## Uso

- Clicar no ícone da extensão com a aba do Assyst aberta.
- Marcar **Atualização automática**.
- Escolher o intervalo (1, 2, 5, 10, 15, 30 min, ou personalizado ≥ 1 min).
- **Atualizar agora** força um ciclo imediato (útil para testar).

## Estados do status

- **Ativo** — clicou e o Assyst confirmou o refresh.
- **Agregando Assyst** — botão não encontrado na página (aguarda o próximo ciclo).
- **Botão não respondeu** — clicou mas o hash não mudou dentro de 2s.
- **Pausado** — automação desativada.

## Segurança

- Sem acesso a outros sites além do declarado em `matches`.
- Sem rede externa, sem coleta de dados, sem mutação de conteúdo além do clique.
- Configurações persistem via `chrome.storage.sync`.