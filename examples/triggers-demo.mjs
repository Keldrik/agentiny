// Terminal demo exercising every trigger type in @agentiny/core.
//
// Run from the repository root:
//   npm run build -w @agentiny/core
//   node examples/triggers-demo.mjs
//
// Or, if it's wired up:
//   npm run demo

import { Agent } from '../packages/core/dist/index.js';

const log = (tag, msg) => console.log(`[${tag.padEnd(6)}] ${msg}`);
const section = (title) => console.log(`\n--- ${title} ---`);

const agent = new Agent({
  initialState: { count: 0, ready: false, taskDone: false },
});

agent.when(
  (s) => s.count > 5,
  [
    (s) => {
      log('when', `count > 5 fired (count=${s.count}); resetting to 0`);
      s.count = 0;
    },
  ],
);

agent.once(
  (s) => s.ready,
  [() => log('once', 'ready=true fired (will not fire again)')],
);

agent.on('login', [() => log('on', `'login' event received`)]);

let pollCount = 0;
agent.every(
  '500ms',
  [() => pollCount < 3],
  [
    () => {
      pollCount++;
      log('every', `poll #${pollCount} (every 500ms, max 3)`);
    },
  ],
);

const next = new Date();
next.setSeconds(0, 0);
next.setMinutes(next.getMinutes() + 1);
const hh = String(next.getHours()).padStart(2, '0');
const mm = String(next.getMinutes()).padStart(2, '0');
const timeStr = `${hh}:${mm}`;
const waitMs = next.getTime() - Date.now();

agent.at(timeStr, [() => log('at', `fired at wall-clock time ${timeStr}`)], { once: true });

console.log('Registered triggers:');
console.log(`  when()  — fires while state.count > 5`);
console.log(`  once()  — fires the first time state.ready becomes truthy`);
console.log(`  on()    — fires on each 'login' event emission`);
console.log(`  every() — fires every 500ms, gated by a condition that stops after 3`);
console.log(`  at()    — fires once at ${timeStr} (~${Math.round(waitMs / 1000)}s from now)`);
console.log(`  waitFor() — awaits a state predicate and resolves with the matching state`);

await agent.start();

section('triggering when()');
agent.updateState({ count: 6 });
await agent.settle();

section('triggering once() (and verifying it does not refire)');
agent.updateState({ ready: true });
await agent.settle();
agent.updateState({ ready: false });
agent.updateState({ ready: true });
await agent.settle();

section('triggering on() — emitting login twice');
agent.emitEvent('login');
await agent.settle();
agent.emitEvent('login');
await agent.settle();

section('awaiting a condition with waitFor()');
// Kick off a "background task" that flips taskDone after a short delay, then
// await it imperatively. waitFor() resolves with the state that satisfied it.
setTimeout(() => agent.updateState({ taskDone: true }), 300);
log('main', 'awaiting state.taskDone === true ...');
const settled = await agent.waitFor((s) => s.taskDone === true);
log('waitFor', `resolved (count=${settled.count}, taskDone=${settled.taskDone})`);

section('waitFor() timeout (predicate never satisfied)');
try {
  await agent.waitFor((s) => s.count > 1000, 300);
} catch (err) {
  log('waitFor', `rejected as expected: ${err.code} — ${err.message}`);
}

section('letting every() poll for ~2s');
await new Promise((r) => setTimeout(r, 2000));

section(`waiting for at(${timeStr}) — up to ~${Math.round(waitMs / 1000) + 2}s`);
await new Promise((r) => setTimeout(r, waitMs + 1500));

await agent.stop();
console.log('\nDemo complete.');
