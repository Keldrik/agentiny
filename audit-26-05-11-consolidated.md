# @agentiny/core — Consolidated Code Audit

**Date:** 2026-05-11
**Sources:** Claude (Opus 4.7), Codex, DeepSeek v4, GLM 5.1, Kimi K2.6
**Scope:** `packages/core/src/`

Attribution shorthand: **[C]** Claude, **[X]** Codex, **[D]** DeepSeek, **[G]** GLM, **[K]** Kimi.

---

## Bugs / correctness issues

### Loop, wake, and timer hygiene

1. **Lost wake signal race in `_waitForNextCycle`** (`agent.ts:688–712`). TOCTOU between the `_stateChanged` check and the `_wakeResolve` install — a `_wake()` that fires in between is dropped silently, adding up to `idleTimeout` (default 100 ms) of latency per affected cycle. Fix: re-check `_stateChanged` *after* installing `_wakeResolve`. **[D]**

3. **No iteration cap on cascading triggers.** A trigger whose actions mutate state into a configuration that re-satisfies its own check loops forever, never quiets, and eventually times out `settle()`. Add `maxCascadeDepth` or a per-evaluation iteration limit. **[C]**

### Lifecycle

4. **`stop()` blocks on in-flight actions with no cancel signal** (`agent.ts:417–459`, `actions.ts:62–77`). `_shouldRun = false` is set, but the loop is `await`ing an action. No `AbortSignal` is plumbed through, so long actions (LLM, HTTP) block `stop()` indefinitely. **[C]**

5. **`stop()`/`pause()` deadlock when called from inside an action.** Both await `this._executionLoop`; the action awaits the lifecycle call; the loop awaits the action. Detect lifecycle calls made from inside the loop and skip awaiting, or add `requestStop()` / `requestPause()` non-awaiting variants. **[X]**

6. **`settle()` while paused gives a misleading error** (`agent.ts:496–530`). The timeout keeps ticking during pause, so resolvers reject with `SETTLE_TIMEOUT` while the real cause was the pause. Error context says "waiting for N quiet cycles" with no mention of pause. **[C]**

7. **`Stopped → Running` transition is implicit/untested.** `start()` only explicitly guards `Running` and `Paused`; `Stopped` falls through. Works, but undocumented and untested. **[G]**

### Events

9. **`_stateChanged` is overloaded for "events emitted"** (`agent.ts:1006`). `emitEvent` sets `_stateChanged = true` even though state didn't change, resetting the quiet-cycle counter and keeping `settle()` from resolving if events stream in with no listeners. Separate this from "work pending." **[C]**

11. **Empty inner maps leak in `_eventLastSeenByTrigger`.** `removeTrigger` deletes the trigger id from inner maps but never deletes the empty map itself. **[K, D]**

### Triggers and state

14. **`enableTrigger()` doesn't wake the loop when paused** — won't fire until the next state change after `resume()`, even if state already matches. Inconsistent with enabling while running. **[K]**

15. **Public trigger getters expose mutable internals.** `getTrigger`, `getAllTriggers`, `getEventTriggersForEvent` return live objects. Mutating `priority` after the sort cache is built does **not** invalidate `_sortedTriggersCache`, so evaluation order silently goes stale. Freeze, copy, or add an `updateTrigger(id, patch)` API. **[X, D]**

16. **`reset()` restores the original *reference*, not a snapshot** (`agent.ts:72`). Because actions mutate state in-place and `_initialState` is stored by reference, `reset()` restores the already-mutated state. Add an `initialStateFactory` or `cloneInitialState` option. **[X, G]**

17. **Direct state mutation doesn't trigger re-evaluation.** `state.count++` inside an action does not set `_stateChanged`. Documented, but the #1 footgun for new users. Consider `mutateState(fn)` or dev-mode warning. **[X, G]**

19. **`State._notify()` silently swallows async subscriber errors** (`state.ts:66–73`). The try/catch only catches sync throws; a rejected promise from a subscriber vanishes. **[G]**

20. **`updateState()` corrupts non-object state** (`agent.ts:132`). `{ ...this.getState(), ...partial }` produces an object for primitive/array `TState`. JSDoc warns, but there's no runtime guard or type constraint. **[G, K]**

### Schedules and delays

21. **`_scheduleControllers` Map grows across stop/start cycles.** `_stopAllScheduledTriggers(true)` stops timers but never clears the map. Harmless (closures guard against firing for removed triggers) but unbounded. **[D, K]**

22. **Delay timers can queue multiple concurrent executions.** A repeating trigger with a `delay` that fires again before the previous delay completes starts a second timer; both execute. Cancel any pending delay before starting a new one. **[K]**

23. **`at()` while paused fires immediately on resume.** Unlike `every()` (whose missed ticks coalesce, which is tested), a wall-clock `at()` whose time passes during pause fires the moment you `resume()`. A "9am standup" trigger fires at 9:05 just because the agent was paused. **[K]**

24. **`at(..., { once: true })` silently ignores `maxFires`** — `once: true` sets `repeat: false`, which removes the trigger after first fire, so `maxFires` is dead. Same underlying issue: **`maxFires` is silently ignored whenever `repeat: false`**. Validate this at `addTrigger()` time. **[G, K]**

### Error reporting

27. **`onError` is invoked for programmer/API errors too** (`agent.ts:395–400, 453–458, 524–528, 562–568`). `AGENT_ALREADY_RUNNING` etc. go through the same callback documented as "errors thrown in check/conditions/actions," polluting logs. **[C]**

28. **`onError` context is minimal.** No `triggerId`, no phase (`check` / `condition` / `action` / `lifecycle`), no `index`, no state reference. Hard to debug larger agents. Introduce an `AgentExecutionError` payload. **[X]**

---

## Design / API concerns

1. **Positional-polymorphic overloads on `when`/`once`/`on`/`at`/`every`.** The middle arg is "actions or conditions, decided by whether the next arg is present." Both are function arrays, so the type system can't catch a conditions-passed-as-actions mistake — conditions silently run as actions. The runtime dispatch (`typeof actionsOrRepeat === 'boolean'`) also breaks if you pass a single function instead of an array. The same ~20-line resolution logic is duplicated 5× across the file. Add an options-object form (`agent.when({ check, conditions, actions, repeat })`) and extract the resolution helper. **[C, G, D]**

2. **No payload on `emitEvent`.** Workaround is to stuff payloads on state, coupling unrelated concerns. **[C, X, D, K]**

3. **Error codes are unexported string literals.** Consumers matching on `error.code` hardcode strings. Export an `AgentErrorCode` const/enum or a literal union type, or move to an `AgentError` subclass hierarchy. **[C, G, K]**

4. **`State` is exported as public API** (`index.ts:21`) but reads like a private dependency of `Agent`. Either document stability guarantees or move to internal. **[C]**

5. **Logger split.** `State` uses `_logger`, `Agent` uses `_onError` — two channels for the same logical concern. Route state subscriber errors through `onError` too. **[C]**

6. **Schedule behavior while paused is undocumented.** `every()` missed ticks coalesce; `at()` fires immediately on resume (see bug #23). Document explicitly; consider options like `missed: "coalesce" | "skip" | "replay"` and `runWhilePaused?: boolean`. **[X, K]**

7. **Actions receive no trigger context.** Only `state`. They don't know which trigger fired them, what event name, or fire count. Forces closures over variables or pushing metadata into state. **[K, X]**

8. **No `hasTrigger(id)` safe-existence check.** Every lookup method throws on missing ids; users wrap in try/catch. **[D]**

9. **`settle()` depends on polling timing.** Quiet-cycles is coupled to the 10ms poll; behavior varies with `idleTimeout` and runtime slowness. A "N ms since last change" model would be more deterministic. **[G]**

10. **Tests co-located in `src/`.** Bundled fine (tsup only emits entry points) but they ship in the npm package source unless excluded via `package.json` `files` or moved out. **[G]**

---

## Missing features (rough impact order)

1. **`agent.waitFor(predicate, timeout?)` / `whenState`.** The single most common ergonomic gap. Today: combine `once()` + manual promise wiring. **[C, G, D]**

2. **Typed event payloads.** `Agent<TState, TEvents>` with `emit(name, payload)`. Both ergonomic and type-safe. **[C, X, D, K]**

3. **`AbortSignal` in action context.** `(state, { signal, triggerId }) => ...`. Required for `stop()` to be reliably fast. **[C, X]**

4. **`agent.dispose()` / `[Symbol.asyncDispose]`.** Idempotent cleanup: stop, clear triggers, drop subscribers, reject pending settles, cancel delays. Enables `await using agent`. **[C, X, G]**

5. **Disposer functions returned from `when`/`once`/`on`/`at`/`every`.** Return `{ id, off() }` rather than just an id. **[X]**

6. **Selectors / derived state.** `agent.derive(s => s.user.id)` — only re-fire dependents when the projection changes. Reduces wasted action runs on object-level updates. **[C, K]**

7. **`subscribe((next, prev) => ...)`.** Include old value. Standard pattern. **[C, G]**

8. **Trigger lifecycle hooks / middleware.** `beforeTrigger`/`afterTrigger`/`onFire`/`onError` per-trigger or global. Enables metrics/tracing without monkey-patching. **[C, D, K]**

9. **Introspection.** `getFireCount(id)`, `getNextFireTime(id)`, `isExecuting(id)`, `getLastError(id)`, `getLastFiredAt(id)`, `getPendingDelays()`, `getPendingSettles()`, `getStats()`, `getEventNames()`, `isTriggerEnabled(id)`. **[C, X, D, G, K]**

10. **Action timeout.** Per-trigger or global. One slow/hanging action blocks the entire loop. **[G, K]**

11. **Throttle / debounce on triggers.** Rapid state changes flood `when()` triggers; users implement this in check/condition functions today. **[D, K]**

12. **`cancelSettle()`.** Cancel a pending settle without stopping the agent. **[D, G]**

13. **Batch state updates.** `agent.batch(fn)` — evaluates triggers once at the end. **[K]**

14. **Execution policy options.** Sequential default, optional parallel action execution; max-executions-per-cycle; "continue vs stop on first error." **[X, D]**

15. **Debug/trace mode.** Optional logger covering every check, condition result, action execution, and state change. **[D, K]**

16. **Bulk `addTriggers([...])` / `removeTriggers([...])`.** **[C]**

17. **`every()`: setInterval vs recursive setTimeout drift.** Today action duration adds to the interval. Document or offer fixed-rate. **[C]**

18. **`every()` `once: true` option** for symmetry with `at()`. **[G]**

19. **`restart()` from `Stopped`** (or simply allow `start()` from `Stopped` explicitly). **[G]**

20. **State snapshot / immutable mode.** `getSnapshot()` returning a deep clone, or `{ immutable: true }` config. **[X, G]**

21. **Named agents** for logs when multiple agents run. **[K]**

22. **Cron-like scheduling**, **trigger groups** (bulk enable/disable). **[K]**

---

## Minor / polish

- Unused `AgentStatus` type import in `agent.ts:5` — shadowed by `AgentStatusEnum`. **[D]**
- Empty-set cleanup in event tracking is fragile (relies on ordered cleanup across `_eventTriggers` + `_eventLastSeenByTrigger`); consolidate into a `_removeEventTracking(triggerId)` helper. **[D]**
- `at()`'s DST-safe claim overstates the case for the narrow window where a DST transition lands between `from` and the target on the same calendar day. **[C]**
- `reset()` doesn't reset `_triggerFireCount` / `_disabledTriggers` when `clearTriggersOnReset=false`. Probably correct, but undocumented. **[C]**
- `Array.sort()` stability is relied on — fine for ES2020 target (guaranteed since ES2019) but worth noting if anything ever down-levels. **[K]**

---

## Test gaps worth filling **[X]**

- Trigger added while agent running, where current state already satisfies it.
- `await agent.stop()` from inside an action.
- `await agent.pause()` from inside an action.
- Stale idle-timer cleanup with a large `idleTimeout`.
- Mutating a returned trigger object — observing cache/validation behavior.
- Event coalescing across multiple `emitEvent()` in one cycle.
- Condition-failed event consumption (event marked seen, conditions fail, event lost).
- Invalid `idleTimeout` / `delay` / `priority` / empty-string id / non-function actions from JS callers.
- `at()` behavior while paused (parallel to existing `every()` pause test).

---

## Recommended prioritization

If only a handful are picked up:

1. **Bug #4** — `AbortSignal` on `stop()` (and through actions).
2. **Bug #8** — Event emission coalescing semantics (document or redesign).
3. **Bug #3** — Cascade iteration cap.
4. **Bug #1** — Wake signal race.
5. **Bug #5** — `stop()`/`pause()` deadlock from inside actions.
6. **Bug #13/#15** — Triggers added/enabled while running don't evaluate; mutable getters bypass cache.
7. **Design #3** — Export error code constants.
8. **Feature #1** — `agent.waitFor(predicate)`.
9. **Feature #2** — Typed event payloads.

Together these address the real correctness gaps (cancellation, races, cascades, event semantics) and the two most common ergonomic complaints (waiting on state, structured events).
