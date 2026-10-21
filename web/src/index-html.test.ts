import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('manifest é buscado com credenciais (cookie portal_key)', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  expect(html).toMatch(/<link[^>]*rel="manifest"[^>]*crossorigin="use-credentials"/);
});
