import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import { vi } from 'vitest';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost']);

export interface NetworkAttempt {
  api: string;
  target: string;
}

function describeTarget(args: unknown[]): string {
  const [first] = args;
  if (typeof first === 'string') return first;
  if (first instanceof URL) return first.href;
  if (Array.isArray(first)) return describeTarget(first);
  if (first && typeof first === 'object') {
    const o = first as Record<string, unknown>;
    return String(o.host ?? o.hostname ?? o.path ?? o.href ?? JSON.stringify(o));
  }
  return String(first);
}

function isLoopback(target: string): boolean {
  if (LOOPBACK.has(target)) return true;
  try {
    return LOOPBACK.has(new URL(target).hostname.replace(/^\[|\]$/g, ''));
  } catch {
    return false;
  }
}

/**
 * Records every outbound network primitive: DNS, raw sockets, http(s) clients
 * and fetch. Loopback connections (supertest talking to the in-process server)
 * are allowed through; anything else is blocked and recorded.
 */
export function guardNetwork() {
  const attempts: NetworkAttempt[] = [];

  function guard<T extends object>(target: T, name: keyof T & string, api: string, isAsync = false) {
    const original = (target[name] as (...a: unknown[]) => unknown).bind(target);
    vi.spyOn(target, name as never).mockImplementation(((...args: unknown[]) => {
      const dest = describeTarget(args);
      if (isLoopback(dest)) return original(...args);
      attempts.push({ api, target: dest });
      const error = new Error(`Blocked outbound network access via ${api} to ${dest}`);
      if (isAsync) return Promise.reject(error);
      throw error;
    }) as never);
  }

  const originalConnect = net.Socket.prototype.connect;
  vi.spyOn(net.Socket.prototype, 'connect').mockImplementation(function (this: net.Socket, ...args: unknown[]) {
    const dest = describeTarget(args);
    if (isLoopback(dest)) return (originalConnect as (...a: unknown[]) => net.Socket).apply(this, args);
    attempts.push({ api: 'net.Socket.connect', target: dest });
    throw new Error(`Blocked outbound socket to ${dest}`);
  });

  for (const fn of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny'] as const) {
    guard(dns, fn, `dns.${fn}`);
    guard(dns.promises, fn, `dns.promises.${fn}`, true);
  }
  for (const [mod, name] of [[http, 'http'], [https, 'https']] as const) {
    guard(mod, 'request', `${name}.request`);
    guard(mod, 'get', `${name}.get`);
  }
  guard(globalThis, 'fetch', 'fetch', true);
  syncBuiltinESMExports();

  return { attempts };
}
