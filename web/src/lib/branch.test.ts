import { describe, expect, it } from 'vitest';
import { suggestBranch } from './branch';

describe('suggestBranch', () => {
  it('hotfix parte de main', () => {
    expect(suggestBranch('hotfix', 'feature/login', ['main', 'feature/login'])).toEqual({ from: 'main', prefix: 'hotfix/' });
  });
  it('hotfix cai para master quando não há main', () => {
    expect(suggestBranch('hotfix', 'x', ['master']).from).toBe('master');
  });
  it('feature parte da branch atual', () => {
    expect(suggestBranch('feature', 'dev', ['main', 'dev'])).toEqual({ from: 'dev', prefix: 'feature/' });
  });
  it('outra parte da atual sem prefixo', () => {
    expect(suggestBranch('outra', 'dev', ['main', 'dev'])).toEqual({ from: 'dev', prefix: '' });
  });
});
