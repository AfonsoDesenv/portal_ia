import { describe, expect, it } from 'vitest';
import { isPortalShortcut } from './shortcuts';

const k = (key: string, o: Partial<KeyboardEvent> = {}) => ({ key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...o });

describe('isPortalShortcut', () => {
  it('Ctrl+P e Ctrl+Shift+R são atalhos', () => {
    expect(isPortalShortcut(k('p', { ctrlKey: true }))).toBe(true);
    expect(isPortalShortcut(k('P', { ctrlKey: true }))).toBe(true);
    expect(isPortalShortcut(k('R', { ctrlKey: true, shiftKey: true }))).toBe(true);
  });
  it('outras teclas seguem para o terminal', () => {
    expect(isPortalShortcut(k('p'))).toBe(false);
    expect(isPortalShortcut(k('r', { ctrlKey: true }))).toBe(false);
    expect(isPortalShortcut(k('c', { ctrlKey: true }))).toBe(false);
    expect(isPortalShortcut(k('p', { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isPortalShortcut(k('p', { ctrlKey: true, altKey: true }))).toBe(false);
  });
});
