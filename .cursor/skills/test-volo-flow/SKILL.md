---
name: test-volo-flow
description: >-
  Tests the create-volo-app CLI end-to-end against a local volo-app template.
  Use when validating CLI or template changes, running scaffold smoke tests,
  checking validateTemplate requirements, or verifying volo-config.json flows.
disable-model-invocation: true
---

# Test Volo Flow

End-to-end smoke test for `create-volo-app` using a local `volo-app` template.

**Prerequisites:** Open the **create-volo-app** repository as the workspace (or ensure the shell cwd is its root).

Use `required_permissions: ["all"]`.

## Shell commands

Run every command from the **create-volo-app repository root**. Do **not** prefix commands with `cd … &&` — that triggers extra approval and is unnecessary. Set the shell tool's `working_directory` to the repo root instead.

## Fixed paths (nothing else is touched)

| Path | Purpose |
|------|---------|
| `.tmp/volo-flow-test` | Scaffolded test project |
| `.tmp/volo-flow-test.state.json` | Run metadata (includes dev pid and frontend URL after `dev`) |
| `.tmp/volo-flow-test.dev.log` | Captured stdout/stderr from `test:volo-flow:dev` (for debugging API/service failures) |

Template default: `../volo-app` (override with `VOLO_APP_TEMPLATE`).

## 1. Run scaffold + verification

```bash
pnpm test:volo-flow
```

Steps (each prints OK or FAILED):

1. Check test dir (refuses to overwrite unless `--force`)
2. Check pnpm
3. Build CLI
4. Scaffold test project
5. Verify scaffold structure
6. Verify builds

On failure: prints a summary, leaves `.tmp/volo-flow-test` in place for inspection.

Replace an existing test dir:

```bash
pnpm test:volo-flow -- --force
```

## 2. Start dev server

```bash
pnpm test:volo-flow:dev
```

Starts the scaffolded app in the background with `VOLO_DEV_IGNORE_STDIN=1`, waits for `VOLO_DEV_FRONTEND_URL=…` and `VOLO_DEV_BACKEND_URL=…` from `scripts/run-dev.js`, verifies backend `GET /` health, captures all service output to `.tmp/volo-flow-test.dev.log`, writes URLs and dev pid to state, then **exits** while services keep running.

On failure (timeout, process exit, or backend health check), prints a filtered excerpt from the dev log before exiting non-zero.

## 3. Browser verification (AI)

1. Open the frontend URL from the dev command output or state file.
2. Confirm **Welcome to Your App!**
3. Optionally confirm the auth UI renders. Full sign-in is not required.

## 4. Stop dev server and cleanup

```bash
pnpm test:volo-flow:stop
pnpm test:volo-flow:cleanup
```

`stop` sends SIGINT to the pid recorded in state and waits for shutdown. `cleanup` stops the dev server if needed, then deletes only `.tmp/volo-flow-test` and `.tmp/volo-flow-test.state.json`.

## validateTemplate() requirements

These files must exist in the template. Do not remove or rename them without updating `src/utils/template.ts`:

- `package.json` (must include `template.placeholders`)
- `server/src/api.ts`
- `server/src/trpc/router.ts`
- `server/src/server.ts`
- `server/src/lib/env.ts`
- `server/.env.example`
- `server/platforms/cloudflare/wrangler.toml.template`
- `ui/platforms/cloudflare/wrangler.toml.template`
- `ui/src/lib/firebase-config.template.json`
- `scripts/post-setup.js`
- `scripts/run-dev.js`
- `scripts/deploy-guard.js`
- `scripts/parse-wrangler-deploy-url.js`
- `server/package.json` (must include `dev`, `deploy`, `deploy:cf` scripts)

Local template copy excludes: `node_modules/`, `.git/`, `dist/`, `.next/`, `data/`.

## Dev readiness log contract

`pnpm test:volo-flow:dev` parses stdout from the scaffolded app’s `pnpm run dev` → volo-app `scripts/run-dev.js`.

Required machine-readable lines (do not rename without updating `scripts/test-volo-flow.mjs`):

```text
VOLO_DEV_FRONTEND_URL=http://localhost:5501
VOLO_DEV_BACKEND_URL=http://localhost:5500
```

After both URLs appear, the runner polls `GET {backendUrl}/` until `{ "status": "ok" }` or times out (30s).

All dev stdout/stderr during startup is appended to `.tmp/volo-flow-test.dev.log`. On startup/health failure, the runner prints a filtered excerpt (lines tagged `[server]`, `[database]`, errors, etc.) plus the full log path. After `dev-ready`, the runner **exits** (dev server keeps running in the background); the log file retains startup output only.

Legacy fallbacks: human `Frontend:` / `Backend:` lines for older templates.
