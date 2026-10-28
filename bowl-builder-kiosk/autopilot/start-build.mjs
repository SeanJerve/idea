#!/usr/bin/env node
// Bowl Lab autopilot: sets up a new project from this spec kit, then runs
// Claude Code unattended until the build is complete (or truly blocked).
//
//   node start-build.mjs <project-folder> [options]
//
// Options:
//   --mode auto|bypass   Permission mode. "auto" (default) runs everything with a
//                        safety classifier. "bypass" skips all checks: use it only
//                        inside a container or VM, never as root.
//   --setup-only         Create the project and stop (no Claude run).
//   --max-runs N         Restart Claude at most N times (default 60).
//   --retry-wait M       Minutes to wait after a short or failed run (default 15,
//                        doubling up to 60). Covers usage limits and crashes.
//   --background         Set up, then keep running detached (survives closing the
//                        terminal or the Claude session that started it). Output
//                        goes to .autopilot/autopilot.log.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const kit = path.resolve(here, '..');
const isWin = process.platform === 'win32';

// ---------- arguments ----------
const argv = process.argv.slice(2);
const opt = { mode: 'auto', setupOnly: false, maxRuns: 60, retryWait: 15, background: false, target: null };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--mode') opt.mode = argv[++i];
  else if (a === '--setup-only') opt.setupOnly = true;
  else if (a === '--max-runs') opt.maxRuns = Number(argv[++i]);
  else if (a === '--retry-wait') opt.retryWait = Number(argv[++i]);
  else if (a === '--background') opt.background = true;
  else if (a === '--skip-docker-check') { /* Docker is optional now; flag kept for compatibility */ }
  else if (!a.startsWith('--') && !opt.target) opt.target = a;
  else fail(`Unknown option: ${a}`);
}
if (!opt.target) fail('Usage: node start-build.mjs <project-folder> [--mode auto|bypass] [--setup-only]');
if (!['auto', 'bypass'].includes(opt.mode)) fail('--mode must be "auto" or "bypass"');
const target = path.resolve(opt.target);
const claudeBin = process.env.AUTOPILOT_CLAUDE || 'claude';   // override only for testing

function fail(msg) { console.error(`\n✗ ${msg}\n`); process.exit(1); }
function say(msg) { console.log(msg); }
// On Windows, npm-installed CLIs are .cmd files that need a shell, so quote arguments.
const winQuote = a => (isWin && /[\s"()&|<>^,;]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args.map(winQuote), { encoding: 'utf8', shell: isWin, ...opts });
}

// ---------- preflight ----------
say('Bowl Lab autopilot\n');
const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor < 20) fail(`Node.js 20 or newer is needed (you have ${process.versions.node}).`);
if (run('git', ['--version']).status !== 0) fail('Git is not installed.');
const hasDocker = run('docker', ['info']).status === 0;
if (!opt.setupOnly && run(claudeBin, ['--version']).status !== 0) {
  fail('Claude Code is not installed or not on PATH. Install it from https://code.claude.com/docs, run "claude" once to sign in, then run this again.');
}
if (opt.mode === 'bypass' && typeof process.getuid === 'function' && process.getuid() === 0) {
  fail('Bypass mode refuses to run as root. Use --mode auto, or run as a normal user inside a container.');
}
say(hasDocker ? '✓ Tools look good' : '✓ Tools look good (Docker not running: the build will use an npm-installed Postgres instead of local Supabase)');

// ---------- project setup (idempotent) ----------
const copy = (from, to) => fs.cpSync(path.join(kit, from), path.join(target, to), { recursive: true });
fs.mkdirSync(target, { recursive: true });
const fresh = !fs.existsSync(path.join(target, 'SPEC.md'));
if (fresh) {
  const ignorable = new Set(['.git', '.spec-kit', '.claude', '.autopilot', '.DS_Store']);
  if (fs.readdirSync(target).filter(f => !ignorable.has(f)).length) fail(`${target} is not empty. Use a new folder.`);
  copy('PROMPT.md', 'SPEC.md');
  for (const d of ['data', 'design', 'database']) copy(d, d);
  copy('prototype/index.html', 'reference/prototype.html');
  copy('PHASES.md', 'docs/PHASES.md');
  copy('autopilot/template/CLAUDE.md', 'CLAUDE.md');
  copy('autopilot/template/PROGRESS.md', 'PROGRESS.md');
  copy('autopilot/template/keep-going.mjs', '.claude/hooks/keep-going.mjs');
  fs.writeFileSync(path.join(target, '.gitignore'),
    ['node_modules/', 'dist/', 'build/', 'coverage/', '.turbo/', '.autopilot/', '.env', '.env.*', '!.env.example',
     'test-results/', 'playwright-report/', 'supabase/.temp/', '.spec-kit/', '.claude/settings.local.json', '.DS_Store', ''].join('\n'));
  if (!fs.existsSync(path.join(target, '.git'))) run('git', ['init', '-q'], { cwd: target });
  if (!run('git', ['config', 'user.email'], { cwd: target }).stdout.trim()) {
    run('git', ['config', 'user.name', 'Bowl Lab Autopilot'], { cwd: target });
    run('git', ['config', 'user.email', 'autopilot@localhost'], { cwd: target });
  }
  run('git', ['add', '-A'], { cwd: target });
  run('git', ['commit', '-q', '-m', 'Project setup from the Bowl Lab spec kit'], { cwd: target });
  say(`✓ Project created at ${target}`);
} else {
  say(`✓ Resuming the project at ${target}`);
}
// Project settings: permissions, CI env, and the Stop hook (absolute path, so it
// works in any shell on any OS). Rewritten on every launch.
const allow = ['pnpm', 'npm', 'npx', 'node', 'corepack', 'git', 'supabase', 'docker', 'psql', 'createdb', 'dropdb', 'playwright', 'vitest', 'tsc', 'turbo', 'k6']
  .map(c => `Bash(${c} *)`);
const settings = {
  permissions: {
    allow,
    deny: ['Bash(git push *)', 'Bash(git remote add *)'],
  },
  env: { CI: '1' },
  hooks: {
    Stop: [{ hooks: [{ type: 'command', command: `node "${path.join(target, '.claude', 'hooks', 'keep-going.mjs').replace(/\\/g, '/')}"`, timeout: 30 }] }],
  },
};
fs.writeFileSync(path.join(target, '.claude', 'settings.local.json'), JSON.stringify(settings, null, 2) + '\n');   // machine-specific, git-ignored
fs.copyFileSync(path.join(kit, 'autopilot/template/keep-going.mjs'), path.join(target, '.claude/hooks/keep-going.mjs'));
if (opt.setupOnly) { say('\nSetup only: not starting Claude.'); process.exit(0); }

// Only one autopilot per project.
const pidFile = path.join(target, '.autopilot', 'pid');
fs.mkdirSync(path.dirname(pidFile), { recursive: true });
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const otherPid = Number((() => { try { return fs.readFileSync(pidFile, 'utf8'); } catch { return 0; } })());
if (otherPid && otherPid !== process.pid && alive(otherPid)) {
  say(`\nThe autopilot is already running for this project (pid ${otherPid}). Progress: ${path.join(target, 'PROGRESS.md')}`);
  process.exit(0);
}

if (opt.background) {
  const logFile = path.join(target, '.autopilot', 'autopilot.log');
  const out = fs.openSync(logFile, 'a');
  const args = process.argv.slice(1).filter(a => a !== '--background');
  const child = spawn(process.execPath, args, { cwd: process.cwd(), detached: true, stdio: ['ignore', out, out], windowsHide: true });
  child.unref();
  say(`\n✓ Autopilot is running in the background (pid ${child.pid}).`);
  say(`  Progress: ${path.join(target, 'PROGRESS.md')}`);
  say(`  Log:      ${logFile}`);
  say('  It keeps going after you close this window. To stop it, end that process; run the same command again to resume.');
  process.exit(0);
}
fs.writeFileSync(pidFile, String(process.pid));

// ---------- supervisor loop ----------
const statusOf = () => {
  const p = (() => { try { return fs.readFileSync(path.join(target, 'PROGRESS.md'), 'utf8'); } catch { return ''; } })();
  return { status: (p.match(/^STATUS:\s*([A-Z_]+)/m) || [])[1] || 'MISSING',
           done: (p.match(/^- \[x\] Milestone [1-8]\b/gim) || []).length, text: p };
};
const PROMPT = 'Continue building Bowl Lab unattended. Follow CLAUDE.md exactly: read PROGRESS.md, work on the first unfinished milestone, ' +
  'commit as you go, and keep going until every milestone is done (then write FINAL_REPORT.md and set STATUS: COMPLETE) or nothing can progress without the owner.';
const logDir = path.join(target, '.autopilot', 'logs');
fs.mkdirSync(logDir, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clock = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function summarize(line) {
  let ev; try { ev = JSON.parse(line); } catch { return; }
  if (ev.type === 'assistant') {
    for (const c of ev.message?.content || []) {
      if (c.type === 'text' && c.text.trim()) say(`[${clock()}] ${c.text.trim().split('\n')[0].slice(0, 200)}`);
      if (c.type === 'tool_use') {
        const detail = c.input?.command || c.input?.file_path || c.input?.pattern || c.input?.description || '';
        say(`          · ${c.name} ${String(detail).split('\n')[0].slice(0, 110)}`);
      }
    }
  } else if (ev.type === 'result') {
    say(`[${clock()}] Session ended (${ev.subtype || 'done'}${ev.num_turns ? `, ${ev.num_turns} turns` : ''}).`);
  }
}

function runClaude(n) {
  return new Promise(resolve => {
    const args = ['-p', PROMPT, '--output-format', 'stream-json', '--verbose',
      '--permission-mode', opt.mode === 'bypass' ? 'bypassPermissions' : 'auto'];
    const log = fs.createWriteStream(path.join(logDir, `run-${String(n).padStart(3, '0')}.jsonl`));
    const env = { ...process.env };
    delete env.CLAUDECODE;                 // started from inside a Claude Code session is fine
    const child = spawn(claudeBin, args.map(winQuote), { cwd: target, shell: isWin, env, stdio: ['ignore', 'pipe', 'pipe'] });
    current = child;
    let buf = '';
    child.stdout.on('data', d => {
      log.write(d); buf += d;
      let i; while ((i = buf.indexOf('\n')) >= 0) { summarize(buf.slice(0, i)); buf = buf.slice(i + 1); }
    });
    child.stderr.on('data', d => { log.write(d); process.stderr.write(d); });
    child.on('close', code => { current = null; log.end(); resolve(code); });
  });
}

let current = null;
process.on('SIGINT', () => {
  if (current) current.kill('SIGINT');
  say('\nStopped. Run the same command again to resume.');
  process.exit(130);
});

let wait = opt.retryWait;
for (let n = 1; n <= opt.maxRuns; n++) {
  const s = statusOf();
  if (s.status === 'COMPLETE' && s.done >= 8) {
    say(`\n✓ Build complete. Read ${path.join(target, 'FINAL_REPORT.md')}`);
    process.exit(0);
  }
  if (s.status === 'BLOCKED') {
    say(`\n! The build needs you. See "Open issues" and "Owner to-do" in ${path.join(target, 'PROGRESS.md')}, then run this again.`);
    process.exit(2);
  }
  say(`\n▶ Run ${n} started at ${clock()} (${s.done} of 8 milestones done). Logs: .autopilot/logs/`);
  const started = Date.now();
  const code = await runClaude(n);
  const minutes = (Date.now() - started) / 60000;
  const after = statusOf().status;
  if (after === 'COMPLETE' || after === 'BLOCKED') continue;   // the loop top reports it
  if (minutes < 5 || code !== 0) {
    say(`Run ${n} ended after ${minutes.toFixed(1)} min (exit ${code}). This is usually a usage limit or a network hiccup.` +
        (wait > 0 ? ` Retrying in ${wait} min.` : ''));
    await sleep(wait * 60000);
    wait = Math.min(Math.max(wait * 2, opt.retryWait), 60);
  } else {
    wait = opt.retryWait;
  }
}
say(`\nStopped after ${opt.maxRuns} runs. Check PROGRESS.md, then run the same command again to continue.`);
process.exit(3);
