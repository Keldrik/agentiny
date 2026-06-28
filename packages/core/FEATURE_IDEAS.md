# @agentiny/core — Feature Ideas

Notes on features that would make the core package more useful, based on a full
read of the current source (`agent.ts`, `state.ts`, `conditions.ts`,
`actions.ts`, `schedule.ts`, `errors.ts`, `types.ts`, `index.ts`) and the
surrounding monorepo (`utils`, `anthropic`, `openai`, `gemini` adapters).

_Captured 2026-06-27._

## What exists today

A clean, zero-dependency trigger → condition → action engine:

- A single reactive state value (`State<T>`, `Object.is` equality).
- Priority-sorted triggers with `repeat` / `delay` / `maxFires` / `priority`.
- Convenience sugar: `when` / `once` / `on` + `emitEvent` / `at` / `every`.
- Full lifecycle: `start` / `pause` / `resume` / `stop` / `reset`.
- `settle()` for quiescence detection.
- Careful event-coalescing semantics and thorough bookkeeping cleanup.

The code quality is high. The items below are about gaps that appear once you
build something non-trivial on top — not fixes.

## Biggest gaps (highest impact)

### 1. Events can't carry a payload

`emitEvent(event: string)` passes no data, so `on('user-login', …)` handlers can
only read global state, not _what_ was emitted. The most limiting thing in the
API. Wants: `emitEvent('message', payload)` → `on('message', (state, payload) => …)`.

Tricky part: the current coalescing model intentionally drops duplicate
emissions, so payload delivery needs a decision — queue (per-message) vs.
last-wins. Lean toward an **opt-in queued delivery mode** for events that carry
data, keeping coalesced wake-signal as the default.

### 2. Give actions/handlers a context object

Actions only receive `state`. To emit an event, call `setState`, or know which
trigger fired, they must close over the `agent` variable. A context arg makes
actions self-contained and composable (matters for the AI adapter packages):

```ts
(ctx) => {
  ctx.state;
  ctx.emit();
  ctx.setState();
  ctx.triggerId;
  ctx.signal;
};
```

Highest-leverage single change for ergonomics. API-shape decision: extra arg vs.
replacing `state`.

### 3. `waitFor(predicate, timeout)` — ✅ DONE

A promise that resolves with the state when it first satisfies a predicate — the
natural sibling to `settle()`. Built on the existing subscribe/wake machinery.
Turns the agent into something you can `await` imperatively:

```ts
const ready = await agent.waitFor((s) => s.ready);
```

Shipped: synchronous predicate, resolves with `Promise<TState>`, evaluated via
both the state subscription (zero-latency, works while idle/paused) and the
execution loop (catches in-place action mutations). Rejects with
`WAITFOR_TIMEOUT` / `AGENT_STOPPED`; throwing predicate rejects the promise.

### 4. Observability hooks + per-trigger metrics

Today the only visibility is `onError`. Debugging a reactive cascade is painful
without knowing _why_ a trigger didn't fire. Add lifecycle hooks
(`onTriggerFired` / `onConditionsFailed` / `onActionError`) and per-trigger stats
(fire count — already tracked in `_triggerFireCount` — plus last-fired
timestamp). This is what makes the framework debuggable at scale.

### 5. `debounce` / `throttle` / `cooldown` on triggers

The timer infrastructure (`delay`) already exists. Debounce (reset on new
change), throttle (rate-limit), and cooldown (min gap between fires) are the
three most-requested reactive primitives and extend what's there naturally.

## Second tier (real, but less universal)

- **Cancellation via `AbortSignal`.** `stop()` waits for the loop to exit but
  in-flight async actions keep running. Threading an `AbortSignal` (via the
  context object in #2) lets long-running actions bail out on stop/pause.
- **Re-entrancy guard / per-trigger concurrency.** If a trigger's async action
  is still running and state changes again, it can fire concurrently. An opt-in
  "skip if previous run in flight" (or "queue") policy prevents a common bug.
- **Functional state updater + the mutation footgun.** `updateState(prev => next)`
  avoids the read-modify-write race in
  `updateState({ count: getState().count + 1 })`. Related: the README flags that
  direct mutation + `Object.is` equality means an in-action mutation won't wake a
  _future_ pass. An optional immutable/produce path (or a `markChanged()` /
  `touch()`) would defuse this footgun.
- **Derived/computed selectors + sliced subscriptions.** `subscribe` fires on
  every change; a memoized `select(fn)` that notifies only when its slice changes
  is a common need once state grows.
- **Trigger tags/groups.** Enable/disable/remove a set of triggers at once
  (`agent.disableGroup('notifications')`). Cheap, scales management.

## Third tier (nice, more niche)

- **Richer scheduling.** `at()` is daily-only and host-local; cron syntax,
  day-of-week ("weekdays at 9am" currently needs a manual condition), and
  explicit timezone support would round it out.
- **State persistence.** `snapshot()` / `restore()` for state (+ fire counts) to
  survive restarts. Functions can't serialize, but the state value can.
- **Per-trigger retry policy.** `@agentiny/utils` already has a `retry` helper;
  wiring an optional `retry` config into trigger execution closes the loop
  between the two packages.

## Recommended build order

1. ~~**`waitFor`** (#3) — small, unlocks imperative await.~~ ✅ done
2. **Action context object** (#2) — small, unlocks composition.
3. **Event payloads** (#1).
4. **Observability hooks** (#4).
5. **debounce / throttle** (#5).

These five would most change how _useful_ the framework feels without growing it
much or compromising the "tiny" identity.

**Design tension to decide up front:** several of these (context object, event
payloads) are API-shape changes. Settling on the context-object pattern early
lets payloads, `emit`, `signal`, and metrics all flow through one consistent
channel instead of being bolted on separately later.
