# Portal IA — Design

Data: 2026-10-20
Status: aprovado

## 1. Intenção e o porquê

O usuário trabalha o dia todo com Claude Code em vários projetos. Hoje, para começar ou retomar qualquer trabalho, ele:

1. cria uma pasta "em algum lugar" (às vezes no Windows, às vezes no WSL);
2. abre o VS Code nela;
3. pede ao Claude para transformar a pasta em repositório e criar o remoto no GitHub;
4. para corrigir um bug, precisa **lembrar onde o projeto está** (Windows ou WSL, procura nos dois), abrir o VS Code, criar uma branch pelo terminal (feature a partir da branch do projeto, ou hotfix a partir da `main`);
5. pede o ajuste ao Claude (que normalmente **não** tem permissão para commitar);
6. revisa o diff na extensão de git do VS Code, seleciona os arquivos, e faz commit e push no terminal.

Resultado: **~10 janelas de VS Code + vários terminais**, cada um com uma ou N sessões do Claude, disputando espaço na tela. Para ler diffs, ele espreme o chat do Claude.

O fluxo de trabalho com IA dele é sempre: ideia → brainstorming → specs em `.md` → aprovação → execução (normalmente na mesma sessão) → review → commit. As tarefas quase sempre rodam em sequência.

O **Portal IA** é um app local (PWA) que concentra tudo isso numa janela só: lista de projetos, sessões do Claude e terminais rodando em paralelo por projeto, review de diff e commit, e uma **gestão de agentes** (Analista, Dev .NET, QA, Sonar...) que guarda o jeito dele de trabalhar para não precisar repetir, e que as sessões usam por delegação.

## 2. Objetivos, não-objetivos, anti-objetivos

### Objetivos
- Criar ou registrar um projeto em um passo, escolhendo Windows ou WSL, com git e GitHub opcionais.
- Nunca mais precisar lembrar onde um projeto está.
- Várias sessões do Claude rodando ao mesmo tempo, em vários projetos, visíveis e alternáveis numa janela só, com status de cada uma.
- Review de diff confortável (tela cheia, estilo VS Code) e commit/push seletivo sem sair do portal.
- Agentes globais, especializados e reutilizáveis, que qualquer sessão consegue usar.
- (Etapa 3) Agentes trabalhando em paralelo em cópias isoladas, sem perder o review.

### Não-objetivos
- Não é uma IDE. Não precisa editar arquivos. Para isso existe o botão "Abrir no VS Code".
- Não é multiusuário e não tem acesso remoto. É uso pessoal, só na máquina local.
- Não substitui o Claude Code. Usa o `claude` CLI instalado (Windows e WSL) como está.
- Não gerencia CI/CD, PRs nem issues (pode vir depois, fora deste escopo).

### Anti-objetivos (falhou mesmo se "funcionar")
- **Perder a capacidade de revisar o código antes do commit.** Nenhum fluxo automático pode commitar na branch de trabalho do usuário.
- Sessões que morrem ao trocar de projeto ou ao fechar a janela.
- Ficar mais pesado ou mais apertado na tela do que o VS Code que ele usa hoje.
- Apagar arquivos do usuário. Remover um projeto do portal só tira da lista, nunca apaga a pasta.

## 3. Restrições e ambiente

- Windows 11 com WSL2 (distro `Ubuntu`; pode haver outras, e `docker-desktop` deve ser ignorada).
- Node 22 instalado no Windows. Git instalado no Windows.
- `claude` CLI instalado **nos dois ambientes**, cada um com sua própria pasta `~/.claude`.
- `gh` (GitHub CLI) **não está instalado** no Windows hoje. Status no WSL desconhecido. O portal precisa detectar e orientar a instalação/login (`gh auth login`) quando o usuário quiser criar um repositório no GitHub.
- VS Code instalado no Windows (`code` no PATH), com suporte a Remote-WSL.
- Skills existentes do usuário em `C:\Users\afons\.claude\skills\` (há uma pasta `synced`). Não há `~/.claude/agents` no Windows ainda.
- O usuário fala português. A interface é em português.

## 4. Como funciona (decidido com o usuário)

### 4.1 Forma do produto
- **PWA** instalável (Chrome/Edge), abrindo em janela própria, servido por um **servidor local em Node** que roda no Windows.
- O servidor é dono de todos os processos (terminais, sessões do Claude). A janela é só uma visão: fechar e reabrir a janela não encerra nada.
- O servidor escuta **apenas em 127.0.0.1** e exige um token/chave, porque dá acesso a terminal.
- *Decisão do Claude:* o servidor inicia automaticamente no login do Windows.
- **Reinício do servidor** (reboot, travamento, atualização), aprovado pelo usuário: os processos não sobrevivem. O portal **persiste** quais projetos estavam abertos e quais sessões do Claude existiam em cada um (com o ID da conversa). Ao voltar, cada sessão aparece com um botão **"Retomar"**, que reabre a mesma conversa (`claude --resume <id>`). O histórico visual do terminal pode se perder. O mesmo vale ao fechar a aba de um projeto e abrir de novo: as sessões anteriores ficam listadas para retomar.

### 4.2 Projetos
- O portal mantém um **registro próprio** de projetos. Começa vazio. Só aparece o que foi criado ou adicionado pelo portal (não varre o disco).
- Cada projeto guarda: nome, ambiente (`windows` | `wsl:<distro>`), caminho no ambiente dele, URL do remoto (se houver).
- **Novo projeto:**
  - Escolher ambiente: Windows ou WSL.
  - Escolher **criar pasta nova** (nome + pasta base) ou **usar pasta existente**.
  - Caixa **"Criar repositório no GitHub"**, **marcada por padrão**. Quando marcada: `git init` (se ainda não for repositório), cria o repositório no GitHub e liga como `origin`.
  - *Decisão do Claude* sobre o primeiro commit:
    - **Pasta nova:** o portal cria `README.md` e um `.gitignore` básico, faz o commit inicial e o push automaticamente (não há código do usuário para revisar).
    - **Pasta existente que ainda não é repositório:** o portal faz `git init`, cria o remoto e **não commita nada**. O usuário faz o primeiro commit pelo modo Review, escolhendo os arquivos (evita subir segredos ou arquivos de build sem revisão). Se não houver `.gitignore`, o portal avisa e oferece criar um.
  - Pasta existente que já é repositório git: só registra (e respeita o remoto que já existir).
- *Decisão do Claude:* pastas base padrão configuráveis por ambiente (`C:\GIT` no Windows, `~/git` no WSL). Repositório no GitHub privado por padrão, com opção de público.
- *Decisão do Claude* sobre GitHub por ambiente: o `gh` e as credenciais do git são usados **no ambiente do projeto** (projeto WSL usa `gh` e git do WSL; projeto Windows usa os do Windows). O portal verifica se o `gh` está instalado e logado naquele ambiente e, se não estiver, mostra como instalar e logar antes de criar o repositório (o login pode precisar ser feito uma vez em cada ambiente). O diálogo mostra a conta pessoal como padrão e lista as organizações às quais o usuário tem acesso.
- **Remover do portal:** só tira da lista.

### 4.3 Abrir e alternar projetos
- **Busca rápida** (estilo Ctrl+P do VS Code) lista todos os projetos registrados, Windows e WSL juntos, com selo do ambiente. Enter abre o projeto.
- **Barra lateral esquerda = projetos abertos**, como abas. Trocar de projeto não para nada. Fechar a aba do projeto encerra as sessões e terminais dele (pedir confirmação se houver sessão trabalhando).
- Cada projeto na barra mostra um **status resumido** das suas sessões: *trabalhando*, *esperando você* (terminou ou pediu permissão) ou *parado*. "Esperando você" deve chamar atenção.

### 4.4 Tela do projeto — modo Trabalho (layout B, escolhido pelo usuário)
- Topo: nome do projeto · seletor de branch · **+ Nova branch** · alternador **Trabalho | Review** · **Abrir no VS Code**.
- Centro, grande: **sessões do Claude em abas** (N por projeto). "+ nova sessão" abre uma sessão limpa na raiz do projeto. Cada aba mostra seu status.
- Embaixo, menor: **terminal** na raiz do projeto (shell do ambiente: PowerShell no Windows, bash no WSL). *Decisão do Claude:* permitir mais de um terminal por projeto em abas também.
- Direita: **lista de alterações** (arquivos modificados, com +/−), com caixas para escolher o que entra no commit, campo de mensagem, botões **Commit** e **Commit + Push**, e "Revisar →" que vai para o modo Review.
- Sessões e terminais rodam **no ambiente do projeto**: projeto no WSL usa o `claude` e o shell do WSL, projeto no Windows usa os do Windows.
- Aprovado pelo usuário: o portal **não bloqueia** commit/push nas sessões interativas do Claude. Cada sessão segue as configurações normais do Claude do usuário, como hoje. O que o portal injeta por sessão é só o necessário para o status (hooks), sem mudar permissões.
- **Abrir no VS Code:** Windows → `code <caminho>`; WSL → abrir via Remote-WSL (`code --remote wsl+<distro> <caminho>`).

### 4.5 Nova branch
- Diálogo: tipo (feature / hotfix / outra), branch de origem, nome.
- Hotfix sugere `main` como origem. Feature sugere a branch atual/do projeto. O nome é pré-preenchido com prefixo (`feature/`, `hotfix/`) e editável.
- "Criar e trocar" faz checkout da nova branch.

### 4.6 Modo Review
- Um botão/atalho alterna para o Review **sem encerrar nada**. Os terminais somem da vista e o diff ocupa quase a tela toda.
- Esquerda: lista de arquivos alterados com caixas de commit, mensagem e Commit / Commit + Push.
- Centro: **editor de diff Monaco** (o mesmo do VS Code), alternando entre lado a lado e junto (inline). Base do diff: working tree contra `HEAD`.
- Embaixo: **barra recolhida do Claude**. Clicar abre a sessão ativa para pedir um ajuste sem sair do Review.
- Voltar para Trabalho mostra tudo como estava.

### 4.7 Agentes (Etapa 2)
- Agentes são **globais**: disponíveis em todos os projetos. O usuário pode criar quantos quiser, inclusive vários "Dev" com especialidades diferentes e agentes muito específicos (ex.: "Sonar").
- Implementados como **subagentes nativos do Claude Code** (arquivos `.md` com frontmatter em `~/.claude/agents/`). A sessão principal delega automaticamente quando o pedido combina com a descrição do agente.
- A tela de agentes permite criar/editar: nome, descrição de quando usar, instruções (o "jeito de trabalhar", ex.: padrões de projeto, SOLID/DDD/CQRS, como interpretar pedidos), ferramentas permitidas, modelo e **skills que o agente carrega**.
- O portal grava cada agente **nos dois ambientes** (`~/.claude/agents` do Windows e do WSL) para funcionar igual em qualquer projeto.
- *Decisão do Claude* sobre sincronização:
  - **O portal é a fonte da verdade** para os agentes e receitas que ele gerencia. Editar no portal sobrescreve os dois ambientes.
  - **Skills:** quando um agente usa uma skill que só existe em um ambiente, o portal copia essa skill para o outro, para o agente se comportar igual nos dois.
  - **Conflito:** se o portal encontrar um agente ou skill com o mesmo nome e conteúdo diferente nos dois ambientes (por exemplo, editado fora do portal), ele mostra os dois e pergunta qual manter. Nunca sobrescreve em silêncio algo que não foi ele que gravou.
- Limitação do Claude Code: **subagente não chama subagente.** Encadeamentos (ex.: Sonar encontra erros → usuário aprova → Dev .NET corrige) são conduzidos pela **sessão principal**, com a aprovação do usuário no meio.
- **Receitas:** fluxos que se repetem (como o do Sonar) podem ser salvos como um comando/skill global (ex.: `/sonar`) que a sessão principal segue, chamando os agentes certos na ordem certa. Também gravados nos dois ambientes.

### 4.8 Paralelo com worktrees (Etapa 3)
- *Decisão do Claude* sobre a arquitetura: quem conduz é a **sessão principal do Claude**, não o portal. É ela que decide, a partir das tarefas, o que pode rodar em paralelo (o usuário pode pedir explicitamente também), e dispara os agentes usando o isolamento por worktree que o próprio Claude Code oferece para subagentes. O portal **observa** (lista as worktrees do projeto, mostra o diff de cada uma ao vivo) e oferece o botão **"Juntar"**. Conflitos são resolvidos pela sessão principal. Assim a Etapa 1 continua modelando só sessões interativas, sem um orquestrador próprio.
- Quando tarefas podem rodar em paralelo, cada agente trabalha numa **cópia isolada do projeto (git worktree)**, numa branch temporária.
- Enquanto rodam, o usuário pode **espiar o diff de cada agente** (só leitura) no portal.
- Ao terminar, o resultado é **juntado na pasta principal do projeto como alterações não commitadas** (merge squash sem commit). Conflitos entre agentes são resolvidos pelo Claude antes, e o usuário é avisado.
- O usuário revisa e commita no modo Review, exatamente como no fluxo normal. **Agentes nunca commitam na branch de trabalho do usuário.**
- Worktrees temporárias são removidas depois de juntar.

## 5. Etapas de entrega

Cada etapa é útil sozinha e é entregue e validada antes da próxima.

1. **Base:** servidor local + PWA; registro de projetos (criar / pasta existente, Windows ou WSL, GitHub opcional); busca rápida; abas de projeto; N sessões do Claude + terminais por projeto; status das sessões; nova branch; modo Review com Monaco; commit / commit + push; Abrir no VS Code; início automático no login.
2. **Agentes:** CRUD de agentes globais com skills; sincronização Windows + WSL; receitas (comandos/skills globais).
3. **Paralelo:** orquestração com worktrees; espiar diff por agente; juntar como alterações não commitadas.

## 6. Decisões deixadas para quem constrói

- Stack exata do front e do servidor (sugestão: Node + `node-pty` para terminais, `xterm.js` no front, Monaco para diff; framework de UI à escolha).
- Onde e como guardar o registro de projetos e configurações (arquivo JSON ou SQLite na pasta do usuário).
- Como executar comandos no WSL (sugestão: `wsl.exe -d <distro> -- ...` rodando git/claude **dentro** do WSL, evitando acessar arquivos do WSL via `\\wsl$` pelo lado Windows, que é lento).
- Como detectar o status das sessões do Claude (sugestão: hooks do Claude Code, como `Stop`, `Notification` e `UserPromptSubmit`, avisando o servidor local, injetados por sessão para não alterar a configuração global do usuário).
- Atalhos de teclado (alternar Trabalho/Review, busca rápida, nova sessão, trocar de projeto).
- Como lidar com agentes que já existam em `~/.claude/agents` (sugestão: importar e mostrar, sem apagar).
- Como instalar o início automático no Windows.
