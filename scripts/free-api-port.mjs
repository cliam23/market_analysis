#!/usr/bin/env node
/**
 * Frees one or more ports before starting the dev server stack.
 * Usage: node scripts/free-api-port.mjs [port1 port2 ...]
 * Falls back to PORT env var, then 3001.
 * macOS/Linux: uses lsof. Windows: no-op with a short hint.
 */
import { execSync } from 'node:child_process';

const argPorts = process.argv.slice(2).map(Number).filter(Boolean);
const ports = argPorts.length
  ? argPorts
  : [Number(process.env.PORT || 3001) || 3001];

if (process.platform === 'win32') {
  console.warn(
    `[free-api-port] Windows: cannot auto-free ports ${ports.join(', ')}. If the server fails with EADDRINUSE, close the other process or set PORT.`,
  );
  process.exit(0);
}

function pidsListeningOnPort(port) {
  try {
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return [...new Set(out.trim().split(/\s+/).filter(Boolean))];
  } catch {
    return [];
  }
}

for (const port of ports) {
  const pids = pidsListeningOnPort(port);
  if (!pids.length) continue;

  for (const pid of pids) {
    try {
      process.kill(parseInt(pid, 10), 'SIGTERM');
      console.log(`[free-api-port] SIGTERM pid ${pid} (was listening on ${port})`);
    } catch (e) {
      if (e && e.code !== 'ESRCH') console.warn(`[free-api-port] pid ${pid}:`, e.message || e);
    }
  }

  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    if (pidsListeningOnPort(port).length === 0) break;
  }

  for (const pid of pidsListeningOnPort(port)) {
    try {
      process.kill(parseInt(pid, 10), 'SIGKILL');
      console.log(`[free-api-port] SIGKILL pid ${pid} (port ${port})`);
    } catch {}
  }
}
