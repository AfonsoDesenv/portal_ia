import { describe, expect, it } from 'vitest';
import type { ProjectView } from '@shared';
import { fuzzyFilter } from './fuzzy';
import { aggregateStatus } from '../store';

const p = (name: string): ProjectView => ({ id: name, name, env: 'windows', path: `C:\GIT\${name}`, createdAt: '', missing: false });

describe('fuzzyFilter', () => {
  it('filtra por subsequência', () => {
    const items = ['loja-api', 'portal_ia', 'bot-zap'].map(p);
    expect(fuzzyFilter(items, 'pia').map((x) => x.name)).toEqual(['portal_ia']);
  });
  it('consulta vazia devolve tudo', () => {
    const items = ['a', 'b'].map(p);
    expect(fuzzyFilter(items, '')).toHaveLength(2);
  });
});

describe('aggregateStatus', () => {
  const s = (status: 'trabalhando' | 'esperando' | 'parado') => ({ id: status, projectId: 'x', kind: 'claude' as const, title: '', status, alive: true, createdAt: '' });
  it('esperando vence', () => expect(aggregateStatus([s('trabalhando'), s('esperando')])).toBe('esperando'));
  it('trabalhando vence parado', () => expect(aggregateStatus([s('parado'), s('trabalhando')])).toBe('trabalhando'));
  it('senão parado', () => {
    expect(aggregateStatus([s('parado')])).toBe('parado');
    expect(aggregateStatus([])).toBe('parado');
  });
});
