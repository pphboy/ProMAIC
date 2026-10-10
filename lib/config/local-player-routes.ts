/** Default local mode exposes supported local operations and explicit AI entry points. */
export function localPlayerApiAllowed(pathname: string): boolean {
  return (
    [
      '/api/persistence',
      '/api/stages',
      '/api/folders',
      '/api/stage-meta',
      '/api/model-config',
      '/api/access-code',
    ].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)) ||
    [
      '/api/agent/runtime',
      '/api/agents',
      '/api/health',
      '/api/server-providers',
      '/api/chat',
      '/api/chat/pi',
      '/api/verify-model',
      '/api/provider/probe-models',
      '/api/quiz-grade',
      '/api/pbl/v2/evaluate',
      '/api/pbl/v2/instructor',
      '/api/pbl/v2/open-task',
      '/api/pbl/v2/simulator',
      '/api/pbl/v2/task/update',
    ].includes(pathname)
  );
}

/** Next's internal request URL can carry its startup port; Host names the actual listener. */
export function localPlayerOriginAllowed(request: { url: string; headers: Headers }): boolean {
  try {
    const internal = new URL(request.url);
    const expected = new URL(
      `${internal.protocol}//${request.headers.get('host') ?? internal.host}`,
    );
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(expected.hostname)) return false;
    const origin = request.headers.get('origin');
    return !origin || new URL(origin).origin === expected.origin;
  } catch {
    return false;
  }
}
