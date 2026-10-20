import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIn } from '../server/env/exec.js';
import { Git, GitError } from '../server/git/git.js';

let dir: string;
let git: Git;
const sh = (args: string[], cwd = dir) => runIn('windows', cwd, 'git', args);

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'portal git '));
  git = new Git(runIn, 'windows', dir);
  await git.init();
  await sh(['config', 'user.name', 'T']);
  await sh(['config', 'user.email', 't@t.com']);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('Git', () => {
  it('repo sem commits: status, fileVersions, commit parcial', async () => {
    expect(await git.isRepo()).toBe(true);
    writeFileSync(join(dir, 'ação.md'), 'um\ndois\n');
    writeFileSync(join(dir, 'com espaço.txt'), 'x\n');
    const st = await git.status();
    const paths = st.map((f) => f.path).sort();
    expect(paths).toEqual(['ação.md', 'com espaço.txt']);
    expect(st.every((f) => f.added > 0)).toBe(true);
    const v = await git.fileVersions('ação.md');
    expect(v.original).toBe('');
    expect(v.modified).toBe('um\ndois\n');
    const hash = await git.commit(['ação.md'], 'primeiro');
    expect(hash).toMatch(/^[0-9a-f]{7,40}$/);
    const after = await git.status();
    expect(after.map((f) => f.path)).toEqual(['com espaço.txt']);
    const log = await sh(['log', '-1', '--format=%B']);
    expect(log.stdout).toContain('primeiro');
  });

  it('rename', async () => {
    writeFileSync(join(dir, 'a.txt'), 'conteudo longo o bastante\nlinha2\nlinha3\n');
    await git.commit(['a.txt'], 'a');
    await sh(['mv', 'a.txt', 'b.txt']);
    const st = await git.status();
    expect(st).toHaveLength(1);
    expect(st[0]).toMatchObject({ path: 'b.txt', oldPath: 'a.txt' });
  });

  it('binário', async () => {
    writeFileSync(join(dir, 'bin.dat'), Buffer.from([0, 1, 2, 0, 3]));
    const st = await git.status();
    expect(st[0].binary).toBe(true);
    expect((await git.fileVersions('bin.dat')).binary).toBe(true);
    await git.commit(['bin.dat'], 'bin');
    writeFileSync(join(dir, 'bin.dat'), Buffer.from([0, 9, 9]));
    expect((await git.status())[0].binary).toBe(true);
  });

  it('commit de renomeação indexada (git mv) com path e oldPath', async () => {
    writeFileSync(join(dir, 'old.txt'), 'o\n');
    writeFileSync(join(dir, 'outro.txt'), 'x\n');
    await git.commit(['old.txt', 'outro.txt'], 'base');
    await sh(['mv', 'old.txt', 'novo ação.txt']);
    writeFileSync(join(dir, 'outro.txt'), 'y\n');
    await git.commit(['novo ação.txt', 'old.txt'], 'rename');
    const show = (await sh(['show', '--name-status', '--format=', '-z', 'HEAD'])).stdout;
    expect(show).toContain('old.txt');
    expect(show).toContain('novo ação.txt');
    expect(show).not.toContain('outro.txt');
    expect((await git.status()).map((f) => f.path)).toEqual(['outro.txt']);
  });

  it('branches e createBranch', async () => {
    writeFileSync(join(dir, 'a.txt'), 'a\n');
    await git.commit(['a.txt'], 'a');
    expect(await git.currentBranch()).toBe('main');
    await git.createBranch('hotfix/x', 'main');
    expect(await git.currentBranch()).toBe('hotfix/x');
    expect((await git.branches()).local.sort()).toEqual(['hotfix/x', 'main']);
  });

  it('checkout troca de branch, rejeita opção e árvore suja conflitante', async () => {
    writeFileSync(join(dir, 'a.txt'), 'a\n');
    await git.commit(['a.txt'], 'a');
    await git.createBranch('dev', 'main');
    writeFileSync(join(dir, 'a.txt'), 'dev\n');
    await git.commit(['a.txt'], 'dev change');
    await git.checkout('main');
    expect(await git.currentBranch()).toBe('main');
    await expect(git.checkout('--detach')).rejects.toBeInstanceOf(GitError);
    writeFileSync(join(dir, 'a.txt'), 'sujo\n');
    await expect(git.checkout('dev')).rejects.toBeInstanceOf(GitError);
    expect(await git.currentBranch()).toBe('main');
  });

  it('push com remoto sem upstream', async () => {
    writeFileSync(join(dir, 'a.txt'), 'a\n');
    await git.commit(['a.txt'], 'a');
    const bare = mkdtempSync(join(tmpdir(), 'bare '));
    try {
      await sh(['init', '--bare', '-b', 'main'], bare);
      await git.setRemote(bare);
      await git.createBranch('hotfix/x', 'main');
      await git.push();
      const r = await sh(['rev-parse', '--abbrev-ref', '@{u}']);
      expect(r.stdout.trim()).toBe('origin/hotfix/x');
      await git.setRemote(bare); // idempotente
      await git.push();
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it('pathspecs são literais: commit de [id].tsx não leva i.tsx', async () => {
    writeFileSync(join(dir, '[id].tsx'), 'a\n');
    writeFileSync(join(dir, 'i.tsx'), 'b\n');
    await git.commit(['[id].tsx'], 'só colchetes');
    const show = (await sh(['show', '--name-only', '--format=', 'HEAD'])).stdout.split('\n').filter(Boolean);
    expect(show).toEqual(['[id].tsx']);
    const st = await git.status();
    expect(st.map((f) => [f.path, f.index])).toEqual([['i.tsx', '?']]);
  });

  it('pathspec mágico (:/) é tratado como nome literal', async () => {
    writeFileSync(join(dir, 'a.txt'), 'a\n');
    await expect(git.commit([':/'], 'magia')).rejects.toBeInstanceOf(GitError);
    expect((await git.status()).map((f) => f.path)).toEqual(['a.txt']);
  });

  it('push sem remoto', async () => {
    writeFileSync(join(dir, 'a.txt'), 'a\n');
    await git.commit(['a.txt'], 'a');
    const p = git.push();
    await expect(p).rejects.toBeInstanceOf(GitError);
    await expect(git.push()).rejects.toThrow('projeto sem remoto');
  });
});
