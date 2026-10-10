import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

import { afterEach, describe, expect, it, vi } from 'vitest';

const { BackendLifecycle } = createRequire(import.meta.url)('../../desktop/lifecycle.cjs');
class Child extends EventEmitter {
  kill = vi.fn();
  postMessage = vi.fn();
}
afterEach(() => vi.useRealTimers());

describe('desktop backend lifecycle', () => {
  it('waits for readiness and binds the window only to loopback', async () => {
    const child = new Child();
    const spawn = vi.fn(() => child);
    const lifecycle = new BackendLifecycle(spawn);
    const started = lifecycle.start();
    expect(lifecycle.start()).toBe(started);
    child.emit('message', { type: 'ready', port: 49152 });
    await expect(started).resolves.toBe('http://127.0.0.1:49152');
    expect(spawn).toHaveBeenCalledTimes(1);
    const stopped = lifecycle.stop();
    expect(child.postMessage).toHaveBeenCalledWith({ type: 'shutdown' });
    child.emit('exit', 0);
    await stopped;
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('fails on early backend exit and never exposes a window URL', async () => {
    const child = new Child();
    const lifecycle = new BackendLifecycle(() => child);
    const started = lifecycle.start();
    child.emit('exit', 1);
    await expect(started).rejects.toThrow('before readiness');
  });

  it('kills a server that never becomes ready', async () => {
    vi.useFakeTimers();
    const child = new Child();
    const lifecycle = new BackendLifecycle(() => child, { startupTimeoutMs: 100 });
    const failure = expect(lifecycle.start()).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(100);
    await failure;
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('forces shutdown when graceful shutdown does not finish', async () => {
    vi.useFakeTimers();
    const child = new Child();
    const lifecycle = new BackendLifecycle(() => child, { shutdownTimeoutMs: 100 });
    const started = lifecycle.start();
    child.emit('message', { type: 'ready', port: 49152 });
    await started;
    const stopped = lifecycle.stop();
    await vi.advanceTimersByTimeAsync(100);
    await stopped;
    expect(child.kill).toHaveBeenCalledOnce();
  });
});
