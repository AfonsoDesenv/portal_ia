import { mkdtempSync, readFileSync, appendFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { StatusWatcher, eventToStatus, writeHookSettings } from '../server/sessions/hooks.js';

const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'Notification', 'Stop'];
const tmp = () => mkdtempSync(join(tmpdir(), 'portal-hooks-'));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('eventToStatus', () => {
  it('mapeia eventos', () => {
    expect(eventToStatus('UserPromptSubmit')).toBe('trabalhando');
    expect(eventToStatus('PreToolUse')).toBe('trabalhando');
    expect(eventToStatus('Stop')).toBe('esperando');
    expect(eventToStatus('Notification')).toBe('esperando');
    expect(eventToStatus('SessionStart')).toBeNull();
    expect(eventToStatus('Outro')).toBeNull();
  });
});

describe('writeHookSettings', () => {
  it('windows: grava 5 eventos e append.mjs', () => {
    const dir = tmp();
    const r = writeHookSettings(dir, 's1', 'windows');
    expect(r.settingsArg).toBe(join(dir, 'hooks', 's1.json'));
    expect(r.statusFile).toBe(join(dir, 'status', 's1.jsonl'));
    const json = JSON.parse(readFileSync(r.settingsArg, 'utf8'));
    expect(Object.keys(json.hooks).sort()).toEqual([...EVENTS].sort());
    const cmd = json.hooks.Stop[0].hooks[0].command as string;
    expect(cmd).toContain('append.mjs');
    expect(cmd).not.toContain(String.fromCharCode(92));
    expect(existsSync(join(dir, 'hooks', 'append.mjs'))).toBe(true);
    writeHookSettings(dir, 's1', 'windows'); // idempotente
  });
  it('wsl: caminhos /mnt/c/', () => {
    const dir = 'C:\Temp\portal x';
    // não grava em C:\Temp: usa diretório real e checa só o formato via mnt
    const real = tmp();
    const r = writeHookSettings(real, 's2', 'wsl:Ubuntu');
    expect(r.settingsArg.startsWith('/mnt/')).toBe(true);
    const json = JSON.parse(readFileSync(join(real, 'hooks', 's2.json'), 'utf8'));
    expect(Object.keys(json.hooks).sort()).toEqual([...EVENTS].sort());
    const cmd = json.hooks.Notification[0].hooks[0].command as string;
    expect(cmd).toContain(`cat >> "$0"; echo >> "$0"`);
    expect(cmd).toContain('/mnt/');
    void dir;
  });
});

describe('StatusWatcher', () => {
  it('emite claude-id e status; linha incompleta espera', async () => {
    const dir = tmp();
    const file = join(dir, 'a.jsonl');
    const w = new StatusWatcher();
    const ids: string[] = [];
    const sts: string[] = [];
    w.on('claude-id', (_s, id) => ids.push(id));
    w.on('status', (_s, st) => sts.push(st));
    w.watch('x', file); // arquivo ainda não existe
    await wait(50);
    writeFileSync(file, '{"hook_event_name":"SessionStart","session_id":"abc"}\n\n');
    appendFileSync(file, '{"hook_event_name":"St');
    await wait(1300);
    expect(ids).toEqual(['abc']);
    expect(sts).toEqual([]);
    appendFileSync(file, 'op"}\nlixo\n');
    await wait(1300);
    expect(sts).toEqual(['esperando']);
    w.unwatch('x');
    appendFileSync(file, '{"hook_event_name":"UserPromptSubmit"}\n');
    await wait(1300);
    expect(sts).toEqual(['esperando']);
  }, 10000);
});
