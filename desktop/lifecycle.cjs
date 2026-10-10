class BackendLifecycle {
  constructor(spawn, { startupTimeoutMs = 60000, shutdownTimeoutMs = 5000, log } = {}) {
    this.spawn = spawn;
    this.startupTimeoutMs = startupTimeoutMs;
    this.shutdownTimeoutMs = shutdownTimeoutMs;
    this.log = log ?? (chunk => process.stdout?.write(chunk));
  }

  start() {
    if (this.startPromise) return this.startPromise;
    this.startPromise = new Promise((resolve, reject) => {
      let timer;
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.child?.kill();
        reject(error);
      };
      try {
        this.child = this.spawn();
        timer = setTimeout(
          () => fail(new Error('Local server startup timed out')),
          this.startupTimeoutMs,
        );
        this.child.once('exit', (code) => {
          this.exited = true;
          fail(new Error(`Local server exited before readiness (${code})`));
        });
        this.child.once('error', (error) =>
          fail(error instanceof Error ? error : new Error('Local server failed')),
        );
        this.child.on('message', (message) => {
          if (message?.type === 'error') return fail(new Error(message.message));
          if (message?.type !== 'ready' || settled) return;
          if (!Number.isInteger(message.port) || message.port < 1 || message.port > 65535) {
            return fail(new Error('Local server sent an invalid port'));
          }
          settled = true;
          clearTimeout(timer);
          resolve(`http://127.0.0.1:${message.port}`);
        });
        // Drain pipes so large server logs cannot block startup or execution.
        const log = chunk => { try { this.log(chunk); } catch { /* Logging must not stop playback. */ } };
        this.child.stdout?.on('data', log);
        this.child.stderr?.on('data', log);
      } catch (error) {
        fail(error);
      }
    });
    return this.startPromise;
  }

  stop() {
    if (this.stopPromise) return this.stopPromise;
    if (!this.child || this.exited) return Promise.resolve();
    this.stopPromise = new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.child.kill();
        resolve();
      }, this.shutdownTimeoutMs);
      this.child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      try {
        this.child.postMessage({ type: 'shutdown' });
      } catch {
        clearTimeout(timer);
        this.child.kill();
        resolve();
      }
    });
    return this.stopPromise;
  }
}

module.exports = { BackendLifecycle };
