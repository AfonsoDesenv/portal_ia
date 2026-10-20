import { spawn } from 'node:child_process';
import { join } from 'node:path';
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

const config = loadConfig();
const store = Store.open(join(config.dataDir, 'state.json'));
const github = new GitHub(runIn);
const projects = new ProjectService({ store, run: runIn, github, config });
const sessions = new SessionService({
  store,
  projects,
  config,
  pty: new PtyManager(),
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
});

await app.listen({ host: '127.0.0.1', port: config.port });

const url = `http://localhost:${config.port}/?key=${config.token}`;
console.log(`Portal IA rodando em ${url}`);
if (process.platform === 'win32' && !process.argv.includes('--no-open')) {
  spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
}
