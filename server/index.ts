import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { Store } from './store/store.js';
import { runIn } from './env/exec.js';
import { detectTools, listEnvironments } from './env/environments.js';
import { GitHub } from './github/gh.js';
import { Git } from './git/git.js';
import { ProjectService } from './projects/projects.js';
import { PtyManager } from './pty/manager.js';
import { buildLaunch } from './pty/launch.js';
import { StatusWatcher } from './sessions/hooks.js';
import { SessionService } from './sessions/sessions.js';
import { listenError, pickWebDir, shutdown } from './startup.js';

const config = loadConfig();
const here = dirname(fileURLToPath(import.meta.url));
// Via tsx (server/) o front fica em ../dist/web; compilado (dist/server/) fica em ../web.
// Só serve pasta compilada (index.html + assets/): <repo>/web é a fonte do Vite (página em branco).
const webDir = pickWebDir([resolve(here, '..', 'dist', 'web'), resolve(here, '..', 'web')]);
if (!webDir) console.warn('Front não compilado — rode npm run build. Só a API está disponível.');
const store = Store.open(join(config.dataDir, 'state.json'));
const github = new GitHub(runIn);
const projects = new ProjectService({ store, run: runIn, github, config });
const pty = new PtyManager();
const sessions = new SessionService({
  store,
  projects,
  config,
  pty,
  watcher: new StatusWatcher(),
  detectTools: (env) => detectTools(env, runIn),
  buildLaunch,
});

const app = buildApp({
  config,
  store,
  sessions,
  projects,
  github,
  gitFor: (p) => new Git(runIn, p.env, p.path),
  listEnvs: listEnvironments,
  detectTools: (env) => detectTools(env, runIn),
  webDir,
});

try {
  await app.listen({ host: '127.0.0.1', port: config.port });
} catch (e) {
  console.error(listenError(e, config.port));
  pty.killAll();
  process.exit(1);
}

let stopping = false;
const stop = (signal: string) => {
  if (stopping) return;
  stopping = true;
  console.log(`Encerrando (${signal})…`);
  shutdown(pty, app)
    .catch((e) => console.error(e))
    .finally(() => process.exit(0));
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

const url = `http://localhost:${config.port}/?key=${config.token}`;
console.log(`Portal IA rodando em ${url}`);
if (process.platform === 'win32' && !process.argv.includes('--no-open')) {
  spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
}
