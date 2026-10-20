import { describe, expect, it } from 'vitest';
import { languageFor } from './language';

describe('languageFor', () => {
  it('mapeia por extensão', () => {
    expect(languageFor('src/App.tsx')).toBe('typescript');
    expect(languageFor('a/b/x.YML')).toBe('yaml');
    expect(languageFor('run.sh')).toBe('shell');
  });
  it('padrão plaintext', () => {
    expect(languageFor('Makefile')).toBe('plaintext');
    expect(languageFor('.env')).toBe('plaintext');
    expect(languageFor('x.zzz')).toBe('plaintext');
  });
});
