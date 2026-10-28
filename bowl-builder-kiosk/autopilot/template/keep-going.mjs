// Claude Code Stop hook: keeps the build running until it is really finished.
// Allows Claude to stop only when PROGRESS.md says "STATUS: BLOCKED", or says
// "STATUS: COMPLETE" with all 8 milestones ticked and FINAL_REPORT.md written.
import fs from 'node:fs';
import path from 'node:path';

const dir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const read = file => { try { return fs.readFileSync(path.join(dir, file), 'utf8'); } catch { return ''; } };
const block = reason => { process.stdout.write(JSON.stringify({ decision: 'block', reason })); process.exit(0); };

try { fs.readFileSync(0, 'utf8'); } catch { /* hook input is not needed */ }

const progress = read('PROGRESS.md');
const status = (progress.match(/^STATUS:\s*([A-Z_]+)/m) || [])[1] || 'MISSING';
const ticked = (progress.match(/^- \[x\] Milestone [1-8]\b/gim) || []).length;

// Safety valve so a confused run can't loop forever.
const stateFile = path.join(dir, '.autopilot', 'state.json');
let state = { continuations: 0 };
try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { /* first run */ }
if (state.continuations >= 400) process.exit(0);

if (status === 'BLOCKED') process.exit(0);
if (status === 'COMPLETE' && ticked >= 8 && read('FINAL_REPORT.md').trim()) process.exit(0);

state.continuations += 1;
fs.mkdirSync(path.dirname(stateFile), { recursive: true });
fs.writeFileSync(stateFile, JSON.stringify(state));

if (status === 'COMPLETE') {
  block(ticked < 8
    ? `PROGRESS.md says COMPLETE, but only ${ticked} of 8 milestones are ticked. Finish the remaining milestones (follow CLAUDE.md), then write FINAL_REPORT.md.`
    : 'All 8 milestones are ticked, but FINAL_REPORT.md is missing. Write it as CLAUDE.md describes, then stop.');
}
block(`The build isn't finished (PROGRESS.md: STATUS: ${status}, ${ticked} of 8 milestones done). The owner is away, so don't wait for them. ` +
      'Continue with the next unfinished step following CLAUDE.md: update PROGRESS.md, commit, and keep going. ' +
      'Set STATUS: BLOCKED only if nothing at all can progress without the owner, and write exactly what you need.');
