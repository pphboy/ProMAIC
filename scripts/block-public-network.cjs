/* eslint-disable @typescript-eslint/no-require-imports -- Test-only Node preload hook. */
const { Socket } = require('node:net');
const connect = Socket.prototype.connect;

// Applied only to the smoke-test backend, never to user-enabled AI sessions.
Socket.prototype.connect = function (...args) {
  let options = args[0];
  if (Array.isArray(options)) options = options[0];
  if (typeof options === 'string' || options?.path) return connect.apply(this, args);
  const host =
    typeof options === 'object'
      ? (options.host ?? options.hostname ?? 'localhost')
      : typeof args[1] === 'string'
        ? args[1]
        : 'localhost';
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    process.send?.({ type: 'network-blocked', host });
    throw new Error(`Smoke-test public network boundary: ${host}`);
  }
  return connect.apply(this, args);
};
