# Contributing

## Setup

Use Node.js 22.12 or newer and npm 10 or newer. Node.js 24 is the recommended
development version and is recorded in `.nvmrc`.

```bash
git clone https://github.com/Keldrik/agentiny.git
cd agentiny
nvm use # optional, if you use nvm
npm ci
npm run check
```

Run commands from the repository root. npm workspaces link the five packages
automatically. Tests use mocked AI clients and do not require API keys.

## Workspace layout

- `packages/core`: state, triggers, conditions, actions, and scheduling.
- `packages/utils`: retry, timeout, and validation wrappers.
- `packages/openai`, `packages/anthropic`, `packages/gemini`: optional AI adapters.
- `examples`: runnable demos.
- `scripts`: maintenance checks.

Core has no runtime dependencies. Keep provider SDKs in the adapter packages.

## Commands

| Command                | Purpose                                                                    |
| ---------------------- | -------------------------------------------------------------------------- |
| `npm run check`        | Lint, check formatting, type-check, test, build, and check package exports |
| `npm run lint`         | Check source, tests, examples, scripts, and build configs with oxlint      |
| `npm run lint:fix`     | Apply oxlint's standard automatic fixes                                    |
| `npm run format`       | Check formatting with oxfmt                                                |
| `npm run format:write` | Apply formatting with oxfmt                                                |
| `npm run typecheck`    | Type-check package source with TypeScript                                  |
| `npm test`             | Run all existing workspace test suites once                                |
| `npm run build`        | Build all packages, starting with core                                     |
| `npm run test:smoke`   | Check built ESM/CommonJS exports and declaration files                     |
| `npm run demo`         | Build core and run the trigger demo; waits for the next wall-clock minute  |

For a single package:

```bash
npm run test -w @agentiny/core # watch mode
npm run test:run -w @agentiny/openai
npm run build -w @agentiny/utils
```

Gemini and utils do not have test suites yet. The root test command runs the
existing core, OpenAI, and Anthropic suites. Package type checks currently cover
source files, not tests or the JavaScript demo.

## Linting and formatting

[Oxlint](https://oxc.rs/docs/guide/usage/linter/config.html) checks correctness
using `.oxlintrc.json`. Warnings also fail the lint command.
[Oxfmt](https://oxc.rs/docs/guide/usage/formatter/config.html) owns formatting,
using `.oxfmtrc.json`: two spaces, single quotes, semicolons, trailing commas,
and a 100-character print width.

Formatting covers packages, examples (including `.mjs`), maintenance scripts,
GitHub workflows, root JSON configs, and the README and contributor guide.
Generated output, coverage, dependencies, and npm's lockfile are excluded.
Personal planning notes are outside the formatting command's scope.

```bash
npm run lint:fix
npm run format:write
npm run check
```

For VS Code, install the **Oxc** extension (`oxc.oxc-vscode`), enable its oxlint
and oxfmt integrations, and select it as the formatter for JavaScript and
TypeScript. Editor settings are local; CLI checks and CI use the committed
configs.

## Dependencies and CI

Keep `package-lock.json` under version control. Use `npm ci` for setup and CI;
use `npm install` when intentionally changing dependencies, and include the
updated manifest and lockfile together.

GitHub Actions runs `npm run check` on Node.js 22 and 24 for pushes and pull
requests. The export smoke check imports built packages in both module formats
and verifies that each public entry point has its declared type file. It does
not make provider API calls.
