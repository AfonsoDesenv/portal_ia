# Portal IA

Portal local (PWA) para gerenciar projetos de programação com IA no Windows e no WSL. Um servidor Fastify (`server/`) e um front React (`web/`) reúnem, numa só janela, os projetos, as sessões do Claude Code, terminais, o status de cada sessão, o modo Review (diff, commit e push seletivos) e a integração com GitHub e VS Code.

## Pré-requisitos

- Node 22 e git, no Windows.
- Em **cada ambiente** que você for usar (Windows e cada distro WSL): `claude` (Claude Code) e `gh` (GitHub CLI).

| Ferramenta | Windows (PowerShell) | WSL (terminal da distro) |
| --- | --- | --- |
| `claude` | `irm https://claude.ai/install.ps1 \| iex` | `curl -fsSL https://claude.ai/install.sh \| bash` |
| `gh` | `winget install GitHub.cli` | `sudo apt install gh` |

- **Depois de instalar `gh` ou `claude`, reinicie o portal**: o servidor só enxerga o PATH novo ao ser reiniciado.
- Em cada ambiente, faça login no GitHub: `gh auth login`.
- Em cada ambiente, configure a identidade do git (necessária para o commit inicial dos projetos novos):

```
git config --global user.name "Seu Nome"
git config --global user.email "voce@exemplo.com"
```

## Instalar e rodar

```
npm install
npm run build
npm start
```

O servidor imprime um link `http://localhost:4317/?key=...` e abre o navegador. Na primeira visita use esse link (ele grava o cookie de acesso); depois basta `http://localhost:4317`.

## Instalar como app (PWA)

No Edge ou Chrome, abra o portal e use "Instalar app" (ícone na barra de endereço ou menu do navegador). O portal passa a abrir numa janela própria.

## Atalhos

- `Ctrl+P`: busca de projeto.
- `Ctrl+Shift+R`: alterna o modo Review.

Funcionam também com o foco no terminal.

## Onde ficam os dados

- `%APPDATA%\portal-ia`: configuração (`config.json`, com porta e token) e estado (`state.json`).
- `%LOCALAPPDATA%\portal-ia`: arquivos temporários (hooks de status e similares).

## Início automático com o Windows

```
npm run build
npm run autostart:install
```

Cria `Portal IA.lnk` na pasta Inicializar; ele roda `node dist\server\index.js --no-open` com janela oculta. Para desinstalar: `npm run autostart:remove`.

O atalho grava o caminho do `node` e da pasta do portal: **depois de atualizar o Node ou mover a pasta, rode `npm run autostart:install` de novo**.

## Modo desenvolvimento

```
npm run dev:server   # API em 4317 (tsx watch)
npm run dev          # Vite em http://localhost:5173
```

Antes, visite uma vez `http://localhost:4317/?key=<token>` para gravar o cookie (ele vale por host, não por porta); depois abra `http://localhost:5173`.

## Checklist de verificação

Para rodar manualmente no navegador:

- [ ] Abrir 2 projetos e 2 sessões do Claude.
- [ ] Enviar um prompt: o status vai para "trabalhando" e depois "esperando".
- [ ] Alternar entre projetos e voltar: a sessão continua intacta.
- [ ] Fechar e reabrir a janela do app: a sessão continua rodando.
- [ ] Reiniciar o servidor: "Retomar" reabre a conversa.
- [ ] Modo Review: diff lado a lado e inline; desmarcar um arquivo; Commit + Push; no GitHub só aparecem os arquivos marcados.
- [ ] `Ctrl+P` e `Ctrl+Shift+R` com o foco no terminal.
- [ ] "Abrir no VS Code" em projeto Windows e em projeto WSL.
- [ ] WSL: instalar `claude` e `gh` na distro, criar um projeto WSL em `~/git` com GitHub, conferir que o status funciona e criar a nova branch `hotfix` a partir de `main`.

## Limitações conhecidas

- Os hooks de status no WSL não foram verificados até que o `claude` seja instalado na distro.
- O seletor de branch lista apenas branches locais.
