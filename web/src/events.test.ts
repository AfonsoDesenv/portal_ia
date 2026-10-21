// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectEvents } from './events';

class FakeWS {
  static all: FakeWS[] = [];
  onopen?: () => void; onclose?: () => void; onmessage?: (m: { data: string }) => void;
  constructor(public url: string) { FakeWS.all.push(this); }
  close() {}
}

describe('connectEvents', () => {
  beforeEach(() => { vi.useFakeTimers(); FakeWS.all = []; vi.stubGlobal('WebSocket', FakeWS); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('chama onReconnect só nas reconexões', () => {
    const re = vi.fn();
    const stop = connectEvents(() => {}, re);
    FakeWS.all[0].onopen!();
    expect(re).not.toHaveBeenCalled();
    FakeWS.all[0].onclose!();
    vi.advanceTimersByTime(2000);
    FakeWS.all[1].onopen!();
    expect(re).toHaveBeenCalledTimes(1);
    stop();
  });
});
