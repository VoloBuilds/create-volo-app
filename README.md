# create-volo-app
AI-ready Full‑Stack Starter Kit for Vibe Coding, Rapid Prototyping & Production Scaling

Create full-stack apps with React, Firebase Auth, and Postgres all set up for you. Start with a full local stack in under 30 seconds and use `connect` when ready - or use the `--full` flag to immediately start with production services hooked up.

![Demo](assets/demo.gif)

## Quick Start

```bash
# Local development (default) - working app in 30 seconds!
npx create-volo-app my-app

# Full production setup
npx create-volo-app my-app --full
```

## What You Get
**Full Stack:**
- ⚛️ React + TypeScript + Vite
- 🎨 Tailwind CSS + ShadCN components
- 🔐 Firebase Authentication (Google Sign-In + optional anonymous access)
- 🔥 Hono API backend (NodeJS)
- 🗄️ Postgres database with Drizzle ORM

**Local Development (Default):**
- ⚡ Runs UI + Server + DB + Auth on your computer
- 🏠 Embedded PostgreSQL database
- 🔧 Firebase Auth emulator
- ✅ Zero sign-ins or accounts needed

**Production (Optional):**
- 🌐 Cloudflare Workers deployment ready (UI + API both as Workers with Static Assets)
- 🗄️ Neon, Supabase, or custom PostgreSQL
- 🔐 Production Firebase Auth

## Development Modes

### 🏠 Local Development (Default)
Perfect for learning, prototyping, and development:
```bash
npx create-volo-app my-app
cd my-app
pnpm run dev
```
Run **`pnpm run dev` from the project root** — this is the supported way to develop. It starts the UI, API, embedded database, and Firebase Auth emulator together and assigns ports automatically. You do not need to run `ui` and `server` separately.

- **Zero authentication required**
- **Working app in 30 seconds**
- All services running locally
- Full authentication and database functionality

### 🌍 Production Setup
For production-ready apps:
```bash
# All production services
npx create-volo-app my-app --full

# Modular: mix local and production services
npx create-volo-app my-app --auth                  # Production Firebase + local database
npx create-volo-app my-app --database neon         # Production database + local auth
npx create-volo-app my-app --deploy                # Deployment setup + local services
npx create-volo-app my-app --deploy cloudflare     # Specify deployment provider
```

### 🔗 Progressive Connection
Start local, connect production services later:
```bash
# Start with local development
npx create-volo-app my-app
cd my-app

# Connect production services when ready (run from project directory)
pnpm connect:auth           # Production Firebase Auth
pnpm connect:database       # Choose database provider
pnpm connect:deploy         # Cloudflare deployment
pnpm connection:status      # Check current setup
```

### 🔐 Authentication Configuration

When setting up Firebase Auth, you'll be asked if you want to allow **anonymous users** to access your app:
- **Enabled**: Users can explore your app immediately, then sign in later to keep their data
- **Disabled**: Users must sign in before accessing any features

Defaults: Enabled in local/fast mode, disabled in interactive production setup.

## Requirements

- Node.js 20+
- pnpm

The CLI will check and guide all other installation as needed.

## Usage Examples

```bash
# Local development - instant setup
npx create-volo-app my-app

# Create project in current folder
npx create-volo-app .

# Production with specific database
npx create-volo-app my-app --database neon
npx create-volo-app my-app --database supabase

# Production Firebase Auth only
npx create-volo-app my-app --auth

# Full production setup
npx create-volo-app my-app --full

# Fast mode (minimal prompts)
npx create-volo-app my-app --full --fast

# Config-driven setup (non-interactive/CI)
npx create-volo-app my-app --config ./volo-config.json

# Generate a config file interactively
npx create-volo-app --init-config

# Print schema + config-mode reference (for agents/CI)
npx create-volo-app --help-config
```

## Upgrading from older CLI flags

These flags were removed; Commander no longer accepts them. If a script still passes one, the CLI exits with a migration hint.

| Removed | Use instead |
| ------- | ----------- |
| `--status --path ./app` | `cd ./app` then `npx create-volo-app --connect` |
| `--path <dir>` | `cd` into the project (connect mode uses cwd) |
| `--branch dev` | `--template <url>#dev` |
| `--db neon` | `--database neon` |
| `--skip-prereqs` | `"options": { "skipPrereqs": true }` in config |
| `--install-deps` | `--fast` or `--config` |
| `--local-template <path>` | `--template <path>` |
| `--non-interactive` | `--fast` or `--config ./volo-config.json` |
| `--no-start` | Run `pnpm run dev` after scaffolding |

## Config file (`volo-config.json`)

Use a config file for **non-interactive** or **CI** scaffolding. Pass it explicitly with `--config ./volo-config.json` (a file in the current directory is **not** loaded automatically). Run `npx create-volo-app --help-config` for the bundled JSON Schema, required fields, auth rules, and links to example configs — external tools can call this instead of duplicating CLI docs.

**Do not commit your real config.** Treat `volo-config.json` like `.env`: it often holds database URLs and other secrets. Generated projects include `volo-config.json` in `.gitignore` by default. Safe, committed samples live under [`examples/`](examples/) — copy and edit those locally, or run `--init-config` to generate a new file.

**Examples:** `examples/volo-config.local.json` uses `"template": "/path/to/volo-app"` as a placeholder — set `options.template` to your local volo-app checkout before use. `pnpm test:volo-flow` ignores that value and passes `--template` (default `../volo-app`, or set `VOLO_APP_TEMPLATE`).

**CI:** Build the config in the job (env vars, secret manager, or a short script), run `create-volo-app` with `--config`, and do not persist the file as a repo artifact unless your pipeline stores secrets securely.

**Overwrite:** Config mode refuses to replace an existing project directory unless you set `"options": { "overwrite": true }`.

**Naming:** The CLI path / folder name can be any valid directory name (spaces, underscores, etc.). When auto-creating cloud resources (Cloudflare worker names, Neon/Supabase project names, Firebase project IDs), the CLI derives a lowercase-hyphen slug from the basename and sanitizes it for each provider. Lookup of `database.action: "existing"` projects uses the literal `projectName` value from config — no sanitization — so it matches the exact cloud project name or ID you specify.

```bash

# Connect services (run from project directory)
npx create-volo-app --connect --auth
npx create-volo-app --connect --database
npx create-volo-app --connect            # show status
```

## Local Services

Start everything with **`pnpm run dev` from the project root**. Avoid running `ui` and `server` in separate terminals unless you have a specific reason.

Your local development environment includes:

- **Database**: Embedded PostgreSQL at `./data/postgres`
- **Auth**: Firebase emulator with demo users
- **Frontend**: `http://localhost:5501` (5500-block; root `pnpm run dev` assigns ports automatically)
- **API**: `http://localhost:5500`

All data persists locally between development sessions in the `data` folder within your project.

**After Cloudflare deploy is connected** (`pnpm connect:deploy` or scaffold with `--deploy`), root `pnpm run dev` switches to **Wrangler dev** and does **not** start embedded PostgreSQL. To keep using the local embedded database, run **`pnpm dev:node`** instead (added to the project when deploy is connected).

**Advanced:** If you run the UI and API separately, set `VITE_API_URL` in `ui/.env.local` to point at your API (for example `http://localhost:5500`). The root dev script handles this for you.

## Production Deployment

From the project root (after `pnpm connect:deploy` or scaffolding with `--deploy`):

**Local dev after deploy connect:** `pnpm run dev` auto-detects Wrangler (Workers runtime) and expects a remote `DATABASE_URL` — embedded PostgreSQL is not started. Use **`pnpm dev:node`** for Node.js dev with the embedded database.

```bash
pnpm run deploy
```

This deploys the API Worker first, detects the Worker URL, writes `ui/.env.production`, then deploys the UI static assets Worker. The UI deploys as a separate Cloudflare Worker; under the hood that step runs `pnpm run build && wrangler deploy`, uploading `ui/dist` as Workers Static Assets.

**Add your Workers domain to Firebase:**
- Go to Firebase Console → Authentication → Settings → Authorized domains
- Add your `*.workers.dev` domain (or your custom domain)

### Backend secrets (Cloudflare Workers)

For production hardening, prefer Wrangler secrets over plain `[vars]` in `server/wrangler.toml`:

```bash
cd server
wrangler secret put DATABASE_URL
```

You can also set variables in the Cloudflare dashboard under Workers → your Worker → Settings → Variables.

### Automated Deployment

For CI/CD, use GitHub Actions or similar with Cloudflare API tokens:
- Run `wrangler deploy` for both the API (`server`) and UI (`ui`) in your pipeline

## Development

```bash
git clone https://github.com/VoloBuilds/create-volo-app.git
cd create-volo-app
pnpm install
pnpm run build
node bin/cli.js test-app
```

## Roadmap
- Make Auth provider modular; support Supabase and Clerk auth
- Make deployment target more modular (support Docker, different backend TS runtimes like Bun)
- Create UI on top of the CLI for more intuitive project config
- Build optional "commit to git" support to push created volo-app to Git
- Build optional auto-deploy process (git actions + any platform-specific configs)
- Add payment integration for Lemon Squeezy
- Create templates for common usecases

## Testing

See [`/test`](./test) for testing tools and instructions.

To smoke-test CLI and template changes against a local `volo-app` checkout:

```bash
pnpm test:volo-flow              # scaffold + verify builds
pnpm test:volo-flow:dev          # start dev server (records pid in state)
pnpm test:volo-flow:stop         # stop dev server
pnpm test:volo-flow:cleanup      # remove .tmp/volo-flow-test artifacts
```

Set `VOLO_APP_TEMPLATE` to point at a non-default template path. Use `--force` to replace an existing test dir: `pnpm test:volo-flow -- --force`.

**Dev log contract:** `test:volo-flow:dev` waits for `VOLO_DEV_FRONTEND_URL` and `VOLO_DEV_BACKEND_URL`, verifies backend health, and captures service logs to `.tmp/volo-flow-test.dev.log`. On failure it prints a log excerpt. If you change those lines in volo-app `scripts/run-dev.js`, update `scripts/test-volo-flow.mjs` here.

## Support

- 📖 [Documentation](https://github.com/VoloBuilds/volo-app)
- 🐛 [Issues](https://github.com/VoloBuilds/create-volo-app/issues)
- 💬 [Discussions](https://github.com/VoloBuilds/create-volo-app/discussions)

## License

MIT 