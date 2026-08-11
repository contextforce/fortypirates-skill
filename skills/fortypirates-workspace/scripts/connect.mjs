#!/usr/bin/env node
/**
 * Connect this machine to the user's Forty Pirates workspace.
 *
 * The ONLY piece of this skill that isn't a plain curl — because a browser
 * can't hand a key back to a terminal without something listening for it.
 * Everything after this is `curl -H "authorization: Bearer $(cat …/token)"`.
 *
 * Same shape as Google's loopback flow for installed apps (`gcloud auth login`,
 * Drive desktop): listen on 127.0.0.1, send the user to an approval page, take
 * what the browser sends back.
 *
 *   node connect.mjs              → open browser, wait, save the key
 *   node connect.mjs --show-url   → print the URL and wait (no browser here)
 *   node connect.mjs --status     → is this machine connected?
 *   node connect.mjs --forget     → delete the local key
 *
 * Zero dependencies, node 18+.
 */

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Production is the only target a user ever needs. FP_API_URL exists so this
// can be pointed at a dev server while testing; it is deliberately not
// documented for users, because a wrong value silently talks to the wrong
// workspace.
const BASE = (process.env.FP_API_URL || 'https://fortypirates.com').replace(/\/$/, '');
const DIR = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'fortypirates');
const TOKEN_FILE = join(DIR, 'token');

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);

function say(msg) { process.stderr.write(msg + '\n'); }
function out(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + '\n'); }
function die(msg) { say(msg); process.exit(1); }

async function readToken() {
  if (process.env.FP_TOKEN) return process.env.FP_TOKEN.trim();
  try { return (await readFile(TOKEN_FILE, 'utf8')).trim() || null; } catch { return null; }
}

/** Confirm a key works before saving it. A stored credential that 401s on
 *  first use fails later and somewhere else, which is harder to diagnose. */
async function whoami(token) {
  const r = await fetch(`${BASE}/api/pirates/me`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  return r.json();
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    const child = spawn(cmd, [url], {
      stdio: 'ignore', detached: true, shell: process.platform === 'win32',
    });
    child.unref();
    return true;
  } catch { return false; }
}

async function connect() {
  const name = process.env.FP_KEY_NAME
    || `${process.env.USER || process.env.USERNAME || 'agent'}@${process.env.HOSTNAME || 'local'}`;
  // The nonce the approval page must echo back. Without it, any page the user
  // visits while this is listening could post a key of its choosing to the port.
  const state = randomBytes(16).toString('hex');

  const server = createServer();
  const received = new Promise((resolve, reject) => {
    server.on('request', (req, res) => {
      const reply = (code, body) => {
        res.writeHead(code, {
          'content-type': 'text/plain',
          // The approval page is a different origin; without these the browser
          // refuses the request before it ever reaches this process.
          'access-control-allow-origin': '*',
          'access-control-allow-headers': 'content-type',
        });
        res.end(body);
      };
      if (req.method === 'OPTIONS') return reply(204, '');
      if (req.method !== 'POST') return reply(405, 'method not allowed');

      let raw = '';
      req.on('data', (chunk) => {
        raw += chunk;
        if (raw.length > 8192) req.destroy();   // nothing legitimate is this big
      });
      req.on('end', () => {
        let payload;
        try { payload = JSON.parse(raw); } catch { return reply(400, 'bad json'); }
        if (payload?.state !== state) return reply(403, 'state mismatch');
        if (!payload?.token) return reply(400, 'no token');
        reply(200, 'ok');
        resolve(payload);
      });
    });
    server.on('error', reject);
  });

  // Port 0 → the OS picks a free one. A fixed port would collide whenever two
  // of these run at once, and nothing here needs a stable address.
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  const url = `${BASE}/cli-auth`
    + `?cb=${encodeURIComponent(`http://127.0.0.1:${port}`)}`
    + `&state=${state}`
    + `&name=${encodeURIComponent(name)}`;

  const opened = !has('--show-url') && openBrowser(url);
  say(opened
    ? `Opening your browser…\nIf nothing opened, visit:\n\n  ${url}\n`
    : `Open this link and click Allow:\n\n  ${url}\n`);
  say('Waiting for approval…');

  let payload;
  try {
    payload = await Promise.race([
      received,
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error('Timed out waiting for approval.')), 300_000)),
    ]);
  } finally {
    server.close();
  }

  const me = await whoami(payload.token);
  if (!me) die('The key we received was rejected. Try again.');

  await mkdir(DIR, { recursive: true, mode: 0o700 });
  // 0600: this file is a credential. World-readable on a shared machine is the
  // same as not having one.
  await writeFile(TOKEN_FILE, payload.token + '\n', { mode: 0o600 });

  return { connected: true, username: me.username, tokenFile: TOKEN_FILE, target: BASE };
}

async function status() {
  const token = await readToken();
  if (!token) return { connected: false, target: BASE };
  const me = await whoami(token);
  return me
    ? { connected: true, username: me.username, target: BASE }
    : { connected: false, reason: 'key rejected — it was revoked or is invalid', target: BASE };
}

async function forget() {
  await rm(TOKEN_FILE, { force: true });
  return {
    connected: false,
    note: `Local key deleted. Revoke it for good at ${BASE}/settings/cli`,
  };
}

const run = has('--status') ? status : has('--forget') ? forget : connect;
run()
  .then(out)
  .catch((e) => die(e?.message || String(e)));
