# Repository Guidelines

## Project Structure & Module Organization
All publishable code lives under `packages/`. Each package keeps its TypeScript sources in `src/` and emits compiled output to `dist/` via `tsc`. Use `packages/core` for the agent runtime, `packages/utils` for optional helpers, and `packages/openai`, `packages/anthropic`, and `packages/gemini` for provider adapters. Shared compiler options and path aliases live in `tsconfig.base.json`; extend them through the local `tsconfig.json` in each package and export new symbols from that package’s `src/index.ts`.

## Build, Test, and Development Commands
Install dependencies inside the package you are editing; the repo does not ship a root manifest yet. Common workflows:

```bash
cd packages/core && npm install && npm run build
cd packages/utils && npm run typecheck
cd packages/openai && npm run build
```

Run builds in dependency order (core → utils → adapters) to confirm cross-package imports.

## Coding Style & Naming Conventions
Target ES2020 modules with strict TypeScript settings. Keep two-space indentation, avoid top-level side effects, and prefer named exports. Follow the existing naming style: `PascalCase` for classes such as `AgentError`, `camelCase` for functions and variables, and reserve `UPPER_SNAKE_CASE` for shared constants. Use concise JSDoc blocks when behaviour needs clarification.

## Testing Guidelines
There is no shared test runner yet, so rely on `npm run typecheck` or `npm run build` as the baseline gate before pushing. When you introduce automated tests, place them in a package-local `tests/` directory (already excluded from builds) and add an `npm run test` script that calls your chosen runner (Vitest or Node’s `node:test`). Document coverage expectations or mocking strategy in your PR description.

## Commit & Pull Request Guidelines
With no recorded Git history in this snapshot, align on Conventional Commits such as `feat(core): add trigger debounce` to keep logs predictable. Each PR should summarise the agent scenario affected, link any issues, and paste the latest build or typecheck output. Attach screenshots only when showcasing UI demos, and request a maintainer review before merging provider adapter changes.

## Provider Configuration Tips
Adapters expect their peer SDKs and API keys. Export `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or `GOOGLE_API_KEY` in your shell before running examples, install the matching SDK locally, and never commit credential files. Pass configuration objects into factory helpers instead of reading secrets from global state so packages remain framework-agnostic.
