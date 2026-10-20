import { spawn } from 'node:child_process';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const app = buildApp({ config });

await app.listen({ host: '127.0.0.1', port: config.port });

const url = `http://localhost:${config.port}/?key=${config.token}`;
console.log(`Portal IA rodando em ${url}`);
if (process.platform === 'win32') {
  spawn('cmd', ['/c', 'start', '', url], { stdio: 'ignore', detached: true }).unref();
}
