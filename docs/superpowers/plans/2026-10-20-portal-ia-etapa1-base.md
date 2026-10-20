# Portal IA — Etapa 1 (Base) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um PWA local que registra projetos (Windows ou WSL), mantém N sessões do Claude e terminais vivos por projeto com status, cria branches, mostra diffs no Monaco em modo Review e faz commit/push seletivo.

**Architecture:** Um servidor Node (Fastify + WebSocket) roda no Windows e é dono de todos os processos (`node-pty`). Comandos de projetos WSL rodam **dentro** do WSL via `wsl.exe -d <distro> --cd <dir> -- ...`. O status das sessões do Claude chega por hooks injetados com `claude --settings <arquivo>`, que gravam o JSON do evento em um arquivo `.jsonl` numa pasta do Windows (o WSL grava via `/mnt/c/...`), observada pelo servidor. O front é React + Vite, servido pelo próprio servidor, com xterm.js e Monaco.

**Tech Stack:** Node 22, TypeScript, Fastify 5, `@fastify/websocket`, `@fastify/static`, `@fastify/cookie`, `node-pty`, `vitest`; React 18, Vite, `@xterm/xterm` + `@xterm/addon-fit`, `@monaco-editor/react`, `zustand`, `@testing-library/react`.

**Spec:** `docs/superpowers/specs/2026-10-20-portal-ia-design.md`

## Global Constraints

- Interface toda em **português**.
- Servidor escuta **somente em `127.0.0.1`**, porta padrão **4317**. Todo request HTTP/WS exige o cookie `portal_key` igual ao token salvo; `/?key=<token>` grava o cookie. Rejeitar `Host` diferente de `localhost:<porta>`/`127.0.0.1:<porta>` (403) e WS com `Origin` diferente (403).
- Dados do portal em `%APPDATA%\portal-ia\` (`state.json`, `config.json`); arquivos temporários de status/hooks em `%LOCALAPPDATA%\portal-ia\` (`status\`, `hooks\`).
- Pastas base padrão: `C:\GIT` (Windows) e `~/git` (WSL). Configuráveis em `config.json`.
- Distros WSL: listar todas, **ignorar `docker-desktop`** (e `docker-desktop-data`).
- Repositório GitHub **privado por padrão**; caixa "Criar repositório no GitHub" **marcada por padrão**.
- `gh`, git e `claude` usados **no ambiente do projeto**. Nunca acessar arquivos do WSL via `\\wsl$`/`\\wsl.localhost` para git.
- **Remover projeto só tira da lista.** Nenhum código do portal apaga pastas de projeto.
- O portal **não bloqueia** commit/push nas sessões do Claude e não injeta permissões, só hooks de status.
- Pasta nova: commit inicial automático com `README.md` + `.gitignore`. Pasta existente sem git: `git init` + remoto, **sem commit**; avisar se não houver `.gitignore` e oferecer criar.
- Status das sessões: `trabalhando` (UserPromptSubmit, PreToolUse), `esperando` (Stop, Notification), `parado` (processo encerrado ou ainda sem evento).
- Fato do ambiente atual: no WSL Ubuntu **não há** `claude`, `gh` nem `node`; no Windows não há `gh`. O portal precisa detectar e mostrar como instalar, sem quebrar.

## Review Focus

1. **Caminhos e nomes com espaço, acento e caracteres especiais** (ex.: `C:\GIT\meu projeto`, arquivo `ação.md`): tudo funciona; git usa `-z` e nada passa por string de shell sem escape. → testes nas Tasks 2 e 4.
2. **Repositório sem nenhum commit** (pasta existente recém-inicializada): status, diff (original vazio), branches e o primeiro commit funcionam. → Task 4.
3. **Pasta de projeto que sumiu ou foi movida**: o projeto aparece com selo "pasta não encontrada", abrir sessão mostra erro claro, nada trava. → Task 6.
4. **Push sem upstream ou sem remoto**: com remoto, faz `push -u origin <branch>`; sem remoto, o commit é feito e o push devolve erro claro "projeto sem remoto". → Task 4.
5. **Ferramenta ausente no ambiente** (`claude`/`gh` faltando no WSL, distro parada): o portal mostra o que falta e o comando de instalação; abrir sessão do Claude nesse ambiente mostra a mensagem em vez de um terminal que fecha na hora. → Tasks 2 e 7.

---

## File Structure

```
package.json, tsconfig.json, vitest.config.ts, .gitignore, README.md
server/
  index.ts                 entrada: cria app, escuta 127.0.0.1:4317, abre navegador
  app.ts                   buildApp(deps) → Fastify (para testes com inject)
  config.ts                caminhos, token, porta, pastas base
  auth.ts                  plugin de token/Host/Origin
  env/paths.ts             toWslPath, joinEnvPath
  env/exec.ts              runIn(env, cwd, cmd, args)
  env/environments.ts      listDistros, detectTools
  store/store.ts           Store JSON atômico
  git/git.ts               operações git
  github/gh.ts             status, orgs, createRepo
  projects/projects.ts     criar / registrar / remover / listar
  pty/launch.ts            buildLaunch (puro)
  pty/manager.ts           PtyManager (spawn, scrollback, attach)
  sessions/hooks.ts        gera settings de hooks, observa status
  sessions/sessions.ts     SessionService (N sessões, retomar)
  routes/*.ts              rotas REST e WS
  vscode.ts                buildVsCodeCommand
scripts/install-autostart.ps1
web/
  index.html, vite.config.ts, public/manifest.webmanifest, public/sw.js, public/icon-*.png
  src/main.tsx, App.tsx, api.ts, events.ts, store.ts
  src/lib/fuzzy.ts, src/lib/branch.ts
  src/components/ Sidebar.tsx, QuickOpen.tsx, NewProjectDialog.tsx, ProjectView.tsx,
                  TopBar.tsx, SessionTabs.tsx, TerminalView.tsx, TerminalPanel.tsx,
                  ChangesPanel.tsx, ReviewView.tsx, NewBranchDialog.tsx, StatusDot.tsx
tests/ (espelha server/), web/src/**/*.test.ts(x)
```

## Tipos compartilhados (`server/types.ts`, importado pelo web via alias `@shared`)

```ts
export type EnvId = 'windows' | `wsl:${string}`;
export interface Project { id: string; name: string; env: EnvId; path: string; remoteUrl?: string; createdAt: string; }
export interface ProjectView extends Project { missing: boolean; }
export type SessionKind = 'claude' | 'shell';
export type SessionStatus = 'trabalhando' | 'esperando' | 'parado';
export interface SessionInfo { id: string; projectId: string; kind: SessionKind; title: string;
  status: SessionStatus; alive: boolean; claudeSessionId?: string; createdAt: string; }
export interface ChangedFile { path: string; oldPath?: string; index: string; worktree: string;
  added: number; removed: number; binary: boolean; }
export interface EnvTools { env: EnvId; git: boolean; claude: boolean; gh: boolean; ghLoggedIn: boolean; }
export interface ExecResult { code: number; stdout: string; stderr: string; }
export type ServerEvent =
  | { type: 'session'; session: SessionInfo }
  | { type: 'session-removed'; id: string }
  | { type: 'git-changed'; projectId: string };
```

---

### Task 1: Repositório, scaffold e autenticação

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `server/types.ts`, `server/config.ts`, `server/auth.ts`, `server/app.ts`, `server/index.ts`
- Test: `tests/auth.test.ts`

**Interfaces:**
- Produces: `loadConfig(dir?: string): Config` com `{ port: number; token: string; dataDir: string; tempDir: string; roots: { windows: string; wsl: string } }` (gera token aleatório de 32 bytes hex na primeira vez e persiste em `config.json`); `buildApp(deps: AppDeps): FastifyInstance`, onde `AppDeps` começa com `{ config: Config }` e as próximas tasks acrescentam campos.

- [ ] **Step 1:** `git init` em `C:\GIT\portal_ia`, `.gitignore` com `node_modules/`, `dist/`, `.superpowers/`. Commit do spec e do plano: `docs: spec e plano da etapa 1`.
- [ ] **Step 2: Testes que falham** em `tests/auth.test.ts` (com `app.inject`):
  - `GET /api/health` sem cookie → 401.
  - `GET /?key=<token>` → 302 para `/` com `Set-Cookie: portal_key=<token>; HttpOnly; SameSite=Strict`.
  - `GET /api/health` com cookie certo → 200 `{ ok: true }`.
  - `GET /api/health` com cookie certo e `Host: evil.com` → 403.
  - `loadConfig(tmp)` duas vezes devolve o mesmo token; `roots` igual a `{ windows: 'C:\\GIT', wsl: '~/git' }`.
- [ ] **Step 3:** Rodar `npx vitest run tests/auth.test.ts` → FAIL.
- [ ] **Step 4:** Implementar `config.ts`, `auth.ts` (hook `onRequest`, que também valida `Origin` em upgrade WS), `app.ts` e `index.ts` (escuta `127.0.0.1`, imprime `http://localhost:4317/?key=...` e abre com `start`).
- [ ] **Step 5:** Rodar → PASS. Commit `feat: scaffold do servidor com autenticação local`.

### Task 2: Camada de ambiente (Windows/WSL)

**Files:**
- Create: `server/env/paths.ts`, `server/env/exec.ts`, `server/env/environments.ts`
- Test: `tests/env.test.ts`

**Interfaces:**
- Produces:
  - `toWslPath(winPath: string): string` (`C:\Users\a b` → `/mnt/c/Users/a b`)
  - `type Runner = (env: EnvId, cwd: string | null, cmd: string, args: string[], opts?: { input?: string; timeoutMs?: number }) => Promise<ExecResult>`
  - `runIn: Runner`. No Windows usa `execFile(cmd, args, { cwd })`. No WSL usa `execFile('wsl.exe', ['-d', distro, ...(cwd ? ['--cd', cwd] : []), '--', cmd, ...args])`. Sem shell nos dois casos, para os argumentos passarem sem interpretação.
  - `parseDistros(raw: Buffer): string[]` (saída UTF-16LE de `wsl -l -q`, sem `docker-desktop*`)
  - `listEnvironments(): Promise<EnvId[]>`
  - `detectTools(env: EnvId, run?: Runner): Promise<EnvTools>`. Verifica `git --version`, `claude --version`, `gh --version`, `gh auth status`. No WSL roda via `bash -lc 'command -v X'`, para enxergar o PATH do perfil.
  - `INSTALL_HINTS: Record<'claude'|'gh', { windows: string; wsl: string }>` (claude WSL: `curl -fsSL https://claude.ai/install.sh | bash`; gh Windows: `winget install GitHub.cli`; gh WSL: `sudo apt install gh`)

- [ ] **Step 1: Testes que falham:** `toWslPath('C:\\GIT\\meu projeto')` → `'/mnt/c/GIT/meu projeto'`; `toWslPath('D:\\x')` → `'/mnt/d/x'`; `parseDistros(Buffer.from('Ubuntu\r\ndocker-desktop\r\n', 'utf16le'))` → `['Ubuntu']`; `runIn('windows', tmp, 'git', ['init', 'pasta com espaço'])` cria a pasta; `detectTools('wsl:Ubuntu', fakeRunner)`, com fake que falha para `claude`, → `{ claude: false, git: true, ... }`. Teste real do WSL (`runIn('wsl:Ubuntu', null, 'echo', ['ação'])` → `stdout` `'ação\n'`) com `it.skipIf(!hasWsl)`.
- [ ] **Step 2:** Rodar → FAIL. **Step 3:** Implementar. **Step 4:** Rodar → PASS.
- [ ] **Step 5:** Commit `feat: execução de comandos em Windows e WSL`.

### Task 3: Store persistente

**Files:** Create `server/store/store.ts`; Test `tests/store.test.ts`

**Interfaces:**
- Produces: `class Store { static open(file: string): Store; get(): State; update(fn: (s: State) => void): void }`, com `State = { projects: Project[]; openProjectIds: string[]; sessions: Omit<SessionInfo,'status'|'alive'>[]; activeProjectId?: string }`. Escrita atômica (arquivo `.tmp` + `rename`).

- [ ] **Step 1: Testes que falham:** arquivo inexistente → estado vazio; `update` e depois `Store.open` de novo → dados persistidos; arquivo com JSON inválido → renomeia para `state.json.corrompido-<timestamp>` e começa vazio.
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** Commit `feat: store JSON com escrita atômica`.

### Task 4: Serviço git

**Files:** Create `server/git/git.ts`; Test `tests/git.test.ts` (repos reais em pasta temporária, ambiente `windows`)

**Interfaces:**
- Consumes: `Runner` (Task 2).
- Produces: `class Git { constructor(run: Runner, env: EnvId, cwd: string) }` com:
  - `isRepo(): Promise<boolean>`, `init(): Promise<void>`, `currentBranch(): Promise<string | null>`
  - `branches(): Promise<{ local: string[]; remote: string[] }>`
  - `createBranch(name: string, from: string): Promise<void>` (`git switch -c name from`)
  - `status(): Promise<ChangedFile[]>`: `git status --porcelain=v1 -z -uall` + `git diff --numstat -z HEAD` (sem HEAD, usar a árvore vazia `4b825dc642cb6eb9a060e54bf8d69288fbee4904`); binário quando numstat dá `-`
  - `fileVersions(path: string): Promise<{ original: string; modified: string; binary: boolean }>` (`original` = `git show HEAD:<path>`, ou `''` se não existir; `modified` = conteúdo atual, lido com `run(env, cwd, 'cat', ['--', path])` no WSL e `fs` no Windows)
  - `commit(files: string[], message: string): Promise<string>` (`git add -A -- ...files` e depois `git commit -m message -- ...files`; devolve o hash)
  - `push(): Promise<void>` (sem upstream: `git push -u origin <branch>`; sem remoto: lança `GitError('projeto sem remoto')`)
  - `setRemote(url: string): Promise<void>`
  - `class GitError extends Error`

- [ ] **Step 1: Testes que falham:**
  - repo novo sem commits: `status()` lista `ação.md` e `com espaço.txt` com `added > 0`; `fileVersions('ação.md').original === ''`.
  - `commit(['ação.md'], 'primeiro')` comita só esse arquivo; `status()` ainda mostra `com espaço.txt`.
  - rename (`git mv a.txt b.txt`) → item com `path: 'b.txt', oldPath: 'a.txt'`.
  - arquivo binário (bytes `0x00`) → `binary: true`.
  - `createBranch('hotfix/x', 'main')` → `currentBranch() === 'hotfix/x'`.
  - push com remoto bare local e sem upstream → depois `git rev-parse --abbrev-ref @{u}` = `origin/hotfix/x`.
  - push sem remoto → rejeita com `GitError` e mensagem `'projeto sem remoto'`.
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** Commit `feat: serviço git (status, diff, branch, commit, push)`.

### Task 5: Serviço GitHub (`gh`)

**Files:** Create `server/github/gh.ts`; Test `tests/gh.test.ts` (Runner falso)

**Interfaces:**
- Produces: `class GitHub { constructor(run: Runner) }` com `status(env): Promise<{ installed: boolean; loggedIn: boolean; user?: string }>`, `orgs(env): Promise<string[]>` (`gh api user/orgs --jq '.[].login'`) e `createRepo(env, cwd, opts: { owner?: string; name: string; private: boolean }): Promise<string>` (`gh repo create <owner/>name --private|--public --source . --remote origin`; devolve a URL lida com `git remote get-url origin`).

- [ ] **Step 1: Testes que falham:** o Runner falso registra as chamadas. `createRepo` com `{ name: 'x', private: true }` chama `gh` com `['repo','create','x','--private','--source','.','--remote','origin']`; com `owner: 'minha-org'` usa `'minha-org/x'`; `status` quando `gh --version` falha → `{ installed: false, loggedIn: false }`.
- [ ] **Step 2–4:** FAIL → implementar → PASS. **Step 5:** Commit `feat: integração com gh`.

### Task 6: Serviço de projetos

**Files:** Create `server/projects/projects.ts`; Test `tests/projects.test.ts`

**Interfaces:**
- Consumes: `Store`, `Git`, `GitHub`, `Runner`, `Config`.
- Produces: `class ProjectService` com
  - `list(): Promise<ProjectView[]>` (`missing` = pasta não existe; no WSL via `test -d`)
  - `create(input: { env: EnvId; name: string; baseDir: string; github: false | { owner?: string; private: boolean } }): Promise<Project>`: cria a pasta (`mkdir -p` no WSL; `~` expandido pelo próprio bash), `git init -b main`, `README.md` (`# <name>`), `.gitignore` (`node_modules/`, `dist/`, `.env`), commit `chore: início do projeto`, e, se `github`, `createRepo` + `push`
  - `register(input: { env: EnvId; path: string; github: false | {...} }): Promise<{ project: Project; warnings: string[] }>`: se não for repo, `init` e, se `github`, `createRepo` **sem commit/push**; sem `.gitignore` → warning `'sem-gitignore'`. Se já for repo, só registra e lê `remoteUrl`.
  - `createGitignore(id): Promise<void>`
  - `remove(id: string): void`: só tira do store (e de `openProjectIds`)
  - `ProjectError` para nome duplicado no mesmo ambiente, pasta destino já existente no `create`, ou pasta inexistente no `register`

- [ ] **Step 1: Testes que falham** (env `windows`, pasta temp, GitHub falso):
  - `create({ name: 'meu projeto', github: false })` → pasta com `README.md`, `.gitignore`, 1 commit, branch `main`.
  - `create` com `github: { private: true }` → `createRepo` chamado com `private: true` e `push` chamado.
  - `register` em pasta com arquivos e sem git → `git rev-list --all` vazio (nenhum commit), `warnings` contém `'sem-gitignore'`.
  - `remove(id)` → pasta continua existindo no disco.
  - apagar a pasta depois de registrar → `list()` devolve `missing: true`.
- [ ] **Step 2–4:** FAIL → implementar → PASS. **Step 5:** Commit `feat: criação e registro de projetos`.

### Task 7: Lançamento de processos e PtyManager

**Files:** Create `server/pty/launch.ts`, `server/pty/manager.ts`; Test `tests/pty.test.ts`

**Interfaces:**
- Produces:
  - `buildLaunch(p: { env: EnvId; cwd: string; kind: SessionKind; claudeArgs?: string[] }): { file: string; args: string[] }`
    - windows/shell → `powershell.exe -NoLogo`, com cwd no próprio spawn
    - windows/claude → `claude.exe ...claudeArgs` (caminho resolvido uma vez com `where.exe claude` e guardado)
    - wsl/shell → `wsl.exe -d <distro> --cd <cwd> -- bash -l`
    - wsl/claude → `wsl.exe -d <distro> --cd <cwd> -- bash -lc 'exec claude "$@"' claude ...claudeArgs` (os argumentos chegam como posicionais, sem montar string)
  - `class PtyManager extends EventEmitter` com `spawn(id, launch, cwd): void`, `write(id, data)`, `resize(id, cols, rows)`, `kill(id)`, `attach(id, onData): { scrollback: string; detach(): void }`, eventos `'exit' (id, code)`. Scrollback em buffer circular de **2 MB** por processo.

- [ ] **Step 1: Testes que falham:** `buildLaunch` para os 4 casos (asserções exatas de `file`/`args`, incluindo cwd `/home/u/meu projeto`). `PtyManager` real: spawn de `cmd.exe /c echo oi` → `attach` depois do fim ainda devolve scrollback com `oi`; evento `exit` com code 0; escrever mais de 2 MB e checar que o scrollback fica ≤ 2 MB e termina com o último trecho.
- [ ] **Step 2–4:** FAIL → implementar → PASS. **Step 5:** Commit `feat: pty manager com scrollback`.

### Task 8: Hooks de status do Claude

**Files:** Create `server/sessions/hooks.ts`; Test `tests/hooks.test.ts`

**Interfaces:**
- Produces:
  - `writeHookSettings(tempDir: string, sessionId: string, env: EnvId): { settingsArg: string; statusFile: string }`. Grava `hooks/<sessionId>.json` com hooks `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `Notification`, `Stop`. Cada hook só **anexa o JSON recebido no stdin** a `status/<sessionId>.jsonl`. Comando no Windows: `node "<tempDir>\hooks\append.mjs" "<statusFile>"` (o script `append.mjs` é gravado junto). Comando no WSL: `sh -c 'cat >> "$0"; echo >> "$0"' '<statusFile em /mnt/c/...>'`. `settingsArg` é o caminho no formato do ambiente.
  - `eventToStatus(hookEventName: string): SessionStatus | null`
  - `class StatusWatcher extends EventEmitter` com `watch(sessionId, statusFile)` e `unwatch(sessionId)`. Lê as linhas novas (`fs.watch` + releitura a partir do último offset) e emite `'status' (sessionId, status)` e `'claude-id' (sessionId, claudeSessionId)` (campo `session_id` do JSON).

- [ ] **Step 1: Testes que falham:** `eventToStatus`: `UserPromptSubmit`/`PreToolUse` → `trabalhando`; `Stop`/`Notification` → `esperando`; `SessionStart` → `null`. O JSON gerado tem os 5 eventos e, no WSL, o caminho começa com `/mnt/c/`. `StatusWatcher`: anexar `{"hook_event_name":"SessionStart","session_id":"abc"}` e depois `{"hook_event_name":"Stop"}` → emite `claude-id 'abc'` e `status 'esperando'`; linha incompleta só é lida quando completar.
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5: Verificação manual (os hooks precisam rodar de verdade):** num terminal Windows, `claude --settings <settingsArg>`, mandar "oi", e o `.jsonl` deve ter `UserPromptSubmit` e `Stop`. Repetir no WSL depois de instalar o claude lá. Se o comando de hook no Windows não rodar, ajustar o comando e registrar no README.
- [ ] **Step 6:** Commit `feat: status das sessões via hooks`.

### Task 9: SessionService e rotas de sessão/eventos

**Files:** Create `server/sessions/sessions.ts`, `server/routes/sessions.ts`, `server/routes/events.ts`; Modify `server/app.ts`; Test `tests/sessions.test.ts`

**Interfaces:**
- Consumes: `PtyManager`, `StatusWatcher`, `writeHookSettings`, `Store`, `ProjectService`, `detectTools`.
- Produces: `class SessionService extends EventEmitter` (emite `ServerEvent`) com
  - `list(projectId): SessionInfo[]` (vivas + as persistidas e não vivas, com `alive: false`, que dá para retomar)
  - `create(projectId, kind, opts?: { resumeClaudeId?: string }): Promise<SessionInfo>`. Para `claude`, usa `claudeArgs = ['--settings', settingsArg]` mais `['--resume', id]` quando for retomar. Títulos `Claude 1..N` e `Terminal 1..N`. Erro `ToolMissing` se `detectTools` disser que falta `claude` no ambiente. Erro se o projeto estiver `missing`.
  - `close(id): void` (mata o processo e remove do store)
  - `closeProject(projectId): void`
  - Na inicialização, sessões persistidas aparecem com `alive: false, status: 'parado'`.
- Rotas: `GET /api/projects/:id/sessions`, `POST /api/projects/:id/sessions { kind, resumeClaudeId? }` (422 `{ erro: 'ferramenta-ausente', ferramenta, dica }` quando falta ferramenta), `DELETE /api/sessions/:id`, WS `/ws/term/:id` (envia `{type:'scrollback',data}` e depois `{type:'data',data}`; recebe `{type:'input',data}` e `{type:'resize',cols,rows}`), WS `/ws/events` (envia `ServerEvent`).

- [ ] **Step 1: Testes que falham** (PtyManager com processo `cmd.exe` falso via injeção): criar 2 sessões `claude` → títulos `Claude 1` e `Claude 2`; recriar o `SessionService` com o mesmo store → as 2 aparecem com `alive: false`; `create(..., { resumeClaudeId: 'abc' })` → `claudeArgs` contém `'--resume','abc'`; `create` com `detectTools` sem claude → 422 com `dica` igual ao `INSTALL_HINTS.claude.wsl`; o WS de eventos recebe `{type:'session'}` quando o status muda.
- [ ] **Step 2–4:** FAIL → implementar → PASS. **Step 5:** Commit `feat: sessões múltiplas com retomada`.

### Task 10: Rotas de projetos, git, GitHub, ambientes e VS Code

**Files:** Create `server/routes/projects.ts`, `server/routes/git.ts`, `server/routes/env.ts`, `server/vscode.ts`; Modify `server/app.ts`; Test `tests/routes.test.ts`

**Interfaces:**
- Produces (JSON; erros como `{ erro: string, mensagem: string }`):
  - `GET /api/environments` → `{ envs: EnvTools[], roots, hints: INSTALL_HINTS }`
  - `GET /api/projects` · `POST /api/projects` (corpo de `create`) · `POST /api/projects/register` · `POST /api/projects/:id/gitignore` · `DELETE /api/projects/:id`
  - `GET /api/open` → `{ openProjectIds, activeProjectId }` · `PUT /api/open` (mesmo formato; tirar um projeto de `openProjectIds` chama `closeProject`)
  - `GET /api/gh/status?env=` → `{ installed, loggedIn, user, orgs }`
  - `GET /api/projects/:id/git/status` → `{ branch, files: ChangedFile[] }` · `GET .../git/branches` · `POST .../git/branches { name, from }` · `GET .../git/file?path=` → `fileVersions` · `POST .../git/commit { files, message, push }` → `{ hash, pushed, erroPush? }` (se o commit der certo e o push falhar, responde 200 com `erroPush`)
  - `POST /api/projects/:id/vscode`
  - `buildVsCodeCommand(p: Project): { file: string; args: string[] }`: Windows → `code <path>`; WSL → `code --remote wsl+<distro> <path>` (executado com `shell: true` no Windows, porque `code` é `.cmd`)
  - Depois de commit ou troca de branch, emitir `{type:'git-changed', projectId}`.

- [ ] **Step 1: Testes que falham** (inject + serviços falsos): commit com push falhando → 200 com `hash` e `erroPush: 'projeto sem remoto'`; `PUT /api/open` sem o projeto X → `closeProject('X')` chamado; `buildVsCodeCommand` WSL com caminho `/home/u/meu projeto` → `['--remote','wsl+Ubuntu','/home/u/meu projeto']`; `GET git/file` com `path` fora do projeto (`../x`) → 400.
- [ ] **Step 2–4:** FAIL → implementar → PASS. **Step 5:** Commit `feat: API de projetos, git e VS Code`.

### Task 11: Front: scaffold PWA, layout, busca rápida e novo projeto

**Files:** Create `web/*` (index.html, vite.config.ts, manifest, sw.js, ícones), `web/src/main.tsx`, `App.tsx`, `api.ts`, `events.ts`, `store.ts`, `lib/fuzzy.ts`, `components/Sidebar.tsx`, `QuickOpen.tsx`, `NewProjectDialog.tsx`, `StatusDot.tsx`; Modify `package.json` (scripts `dev`, `build`, `start`); Modify `server/app.ts` (servir `dist/web` com `@fastify/static`); Test `web/src/lib/fuzzy.test.ts`, `web/src/components/NewProjectDialog.test.tsx`

**Interfaces:**
- Consumes: rotas das Tasks 9 e 10.
- Produces: store `zustand` `useApp` com `{ projects, openIds, activeId, sessions: Record<projectId, SessionInfo[]>, mode: Record<projectId,'trabalho'|'review'> }`; `fuzzyFilter(items: ProjectView[], q: string): ProjectView[]`; `aggregateStatus(s: SessionInfo[]): SessionStatus` (qualquer `esperando` → `esperando`; senão qualquer `trabalhando` → `trabalhando`; senão `parado`).
- Layout: barra lateral esquerda com projetos abertos (nome, selo `Win`/`WSL`, `StatusDot` agregado, "pasta não encontrada"), botão **+ Novo** e área reservada "Agentes" (desabilitada, "em breve"). **Ctrl+P** abre a QuickOpen. Enter abre o projeto (adiciona em `openIds` e salva com `PUT /api/open`). `StatusDot` "esperando" pisca/destaca. Manifest com `display: standalone`, `name: "Portal IA"`; o service worker só existe para permitir a instalação (rede primeiro, sem cache de API).
- NewProjectDialog: ambiente (Windows + cada distro), modo "Pasta nova" (nome + pasta base pré-preenchida com `roots`) ou "Pasta existente" (caminho), caixa **"Criar repositório no GitHub"** marcada por padrão com dono (conta + orgs) e privado/público. Se `gh` não estiver instalado ou logado no ambiente escolhido, mostrar o aviso com a dica e desmarcar a caixa. Warning `sem-gitignore` → oferecer "Criar .gitignore".

- [ ] **Step 1: Testes que falham:** `fuzzyFilter` com `['loja-api','portal_ia','bot-zap']` e `'pia'` → `['portal_ia']`; `aggregateStatus` nos 3 casos; NewProjectDialog: caixa GitHub começa marcada; com `gh` ausente fica desmarcada e mostra `winget install GitHub.cli`.
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** `npm run build && npm start`, abrir o link, criar um projeto Windows sem GitHub e ver que ele aparece na barra e na Ctrl+P. Instalar como app no Edge/Chrome.
- [ ] **Step 6:** Commit `feat: PWA com lista de projetos e criação`.

### Task 12: Tela do projeto, modo Trabalho

**Files:** Create `components/ProjectView.tsx`, `TopBar.tsx`, `SessionTabs.tsx`, `TerminalView.tsx`, `TerminalPanel.tsx`, `NewBranchDialog.tsx`, `lib/branch.ts`; Test `web/src/lib/branch.test.ts`

**Interfaces:**
- Consumes: `/ws/term/:id`, rotas de sessão e de branches.
- Produces: `suggestBranch(kind: 'feature'|'hotfix'|'outra', current: string | null, branches: string[]): { from: string; prefix: string }` (hotfix → `main`, ou `master` se não houver `main`; feature → `current`; outra → `current` com prefixo `''`).
- Layout B: TopBar (nome · seletor de branch · **+ Nova branch** · alternador **Trabalho | Review** · **Abrir no VS Code**). Centro grande com abas de sessão do Claude (status em cada aba, **+ nova sessão**, fechar aba). Sessões não vivas aparecem com botão **Retomar**. Embaixo, painel menor de terminais em abas (redimensionável). Direita: `ChangesPanel` (Task 13).
- `TerminalView`: xterm + fit. **Todos os projetos abertos ficam montados** (escondidos com CSS), para trocar de projeto sem reconectar. Ao conectar, escreve o scrollback.
- 422 `ferramenta-ausente` → painel no lugar do terminal com a dica e um botão "copiar comando".
- Fechar um projeto na barra lateral com alguma sessão `trabalhando` → confirmação "Há sessões trabalhando neste projeto. Fechar mesmo assim?".

- [ ] **Step 1: Testes que falham:** `suggestBranch('hotfix','feature/login',['main','feature/login'])` → `{ from:'main', prefix:'hotfix/' }`; com `['master']` → `from:'master'`; `suggestBranch('feature','dev',[...])` → `{ from:'dev', prefix:'feature/' }`.
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** Verificação manual: abrir 2 projetos, 2 sessões Claude em um deles, mandar um prompt e trocar de projeto. Ao voltar, a sessão continua e o status passou por `trabalhando` → `esperando`. Fechar a janela do app e reabrir: tudo continua. Reiniciar o servidor: as sessões aparecem com **Retomar** e retomar reabre a conversa.
- [ ] **Step 6:** Commit `feat: tela do projeto com sessões e terminais`.

### Task 13: Alterações, modo Review e commit/push

**Files:** Create `components/ChangesPanel.tsx`, `components/ReviewView.tsx`; Test `web/src/components/ChangesPanel.test.tsx`

**Interfaces:**
- Consumes: `git/status`, `git/file`, `git/commit`, evento `git-changed`.
- Produces: `ChangesPanel` (props `{ projectId, compact: boolean }`): lista arquivos com `+added −removed`, caixas (todas marcadas por padrão, menos `.env*`, que começa desmarcado), mensagem, **Commit** e **Commit + Push** (desabilitados sem mensagem ou sem arquivo marcado), e "Revisar →". A seleção é mantida por projeto entre os modos. Atualiza com `git-changed` e também a cada 3 s enquanto visível.
- `ReviewView`: esquerda `ChangesPanel compact`; centro `DiffEditor` do Monaco (`readOnly`, linguagem pelo nome do arquivo, alternância **lado a lado / junto**, binário → aviso "arquivo binário"); embaixo uma barra recolhida "Claude", que expande a sessão ativa do projeto **reaproveitando o mesmo `TerminalView`** (sem novo WS). Atalho **Ctrl+Shift+R** alterna Trabalho/Review.
- Push falhou mas o commit deu certo → aviso "Commit feito. Push falhou: <erroPush>".

- [ ] **Step 1: Testes que falham:** com status `[app.ts, .env, README.md]`, `.env` começa desmarcado e os outros marcados; botões desabilitados sem mensagem; clicar em **Commit + Push** chama `POST git/commit` com `{ files: ['app.ts','README.md'], message, push: true }`; resposta com `erroPush` mostra o aviso.
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5:** Verificação manual: pedir ao Claude uma alteração, entrar no Review, ver o diff lado a lado e junto, desmarcar um arquivo, fazer Commit + Push num repositório com remoto e conferir no GitHub que só os arquivos marcados subiram.
- [ ] **Step 6:** Commit `feat: modo review e commit seletivo`.

### Task 14: Início automático, README e teste ponta a ponta

**Files:** Create `scripts/install-autostart.ps1`, `README.md`; Modify `package.json` (script `autostart:install`)

- [ ] **Step 1:** `install-autostart.ps1` cria `Portal IA.lnk` em `shell:startup`, que roda `node <repo>\dist\server\index.js --no-open` com janela oculta (via `wscript` + `.vbs` gerado). O script também tem `-Remove` para desinstalar.
- [ ] **Step 2:** README em português: pré-requisitos (Node 22, git; `gh` e `claude` em cada ambiente, com os comandos de `INSTALL_HINTS`), `npm install && npm run build && npm start`, como instalar o PWA, atalhos (Ctrl+P, Ctrl+Shift+R) e onde ficam os dados.
- [ ] **Step 3: Ponta a ponta no WSL:** instalar `claude` e `gh` no Ubuntu, criar um projeto WSL em `~/git` com GitHub, abrir sessão do Claude e terminal (bash na pasta certa), status funcionando, Abrir no VS Code (abre via Remote-WSL), nova branch hotfix a partir da `main`, Review e Commit + Push.
- [ ] **Step 4:** Rodar `npx vitest run` → tudo PASS. Commit `feat: autostart e documentação`.
