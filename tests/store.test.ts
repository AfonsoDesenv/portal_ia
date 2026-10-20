import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store/store.js';

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'portal-ia-store-'));
  file = join(dir, 'state.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('Store', () => {
  it('arquivo inexistente começa com estado vazio', () => {
    const store = Store.open(file);
    expect(store.get()).toEqual({ projects: [], openProjectIds: [], sessions: [] });
  });

  it('cria o diretório pai ao salvar', () => {
    const nested = join(dir, 'a', 'b', 'state.json');
    Store.open(nested).update((s) => s.openProjectIds.push('x'));
    expect(existsSync(nested)).toBe(true);
  });

  it('dados gravados por update são persistidos e relidos por Store.open', () => {
    const store = Store.open(file);
    store.update((s) => {
      s.projects.push({
        id: 'p1',
        name: 'meu projeto',
        env: 'windows',
        path: 'C:\\GIT\\meu projeto',
        createdAt: '2026-10-20T00:00:00.000Z',
      });
      s.openProjectIds.push('p1');
      s.activeProjectId = 'p1';
    });

    const reopened = Store.open(file).get();
    expect(reopened.projects).toHaveLength(1);
    expect(reopened.projects[0].path).toBe('C:\\GIT\\meu projeto');
    expect(reopened.openProjectIds).toEqual(['p1']);
    expect(reopened.activeProjectId).toBe('p1');
  });

  it('escrita é atômica: não sobra arquivo .tmp e o arquivo final é JSON válido', () => {
    Store.open(file).update((s) => s.openProjectIds.push('a'));
    expect(existsSync(`${file}.tmp`)).toBe(false);
    expect(JSON.parse(readFileSync(file, 'utf8')).openProjectIds).toEqual(['a']);
  });

  it('arquivo com JSON inválido é renomeado para state.json.corrompido-<timestamp> e começa vazio', () => {
    writeFileSync(file, '{ isto não é json');

    const store = Store.open(file);

    expect(store.get()).toEqual({ projects: [], openProjectIds: [], sessions: [] });
    expect(existsSync(file)).toBe(false);
    const backups = readdirSync(dir).filter((n) => /^state\.json\.corrompido-.+/.test(n));
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(dir, backups[0]), 'utf8')).toBe('{ isto não é json');
  });
});
