# create-volo-app

CLI tool to create production-ready full-stack apps with React, Firebase Auth, and Postgres all set up for you. Start with a local stack in under 30 seconds and connect services later or run with --full to immediately start with production services.

## Quick Start

```bash
# Local development (default) - working app in 30 seconds!
npx create-volo-app my-app

# Full production setup
npx create-volo-app my-app --full
```

## What You Get

**Frontend:**
- ⚛️ React + TypeScript + Vite
- 🎨 Tailwind CSS + ShadCN components
- 🔐 Firebase Authentication (Google Sign-In)

**Backend:**
- 🔥 Hono API backend (NodeJS)
- 🗄️ PostgreSQL with Drizzle ORM
- 🔑 Firebase Admin SDK

**Local Development (Default):**
- ⚡ Runs UI + Server + DB + Auth on your computer
- 🏠 Embedded PostgreSQL database
- 🔧 Firebase Auth emulator
- ✅ Zero sign-ins or accounts needed

**Production (Optional):**
- 🌐 Cloudflare Pages + Workers deployment ready
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
npx create-volo-app my-app --auth          # Production Firebase + local database
npx create-volo-app my-app --database neon # Production database + local auth
npx create-volo-app my-app --deploy        # Deployment setup + local services
```

### 🔗 Progressive Connection
Start local, connect production services later:
```bash
# Start with local development
npx create-volo-app my-app
cd my-app

# Connect production services when ready
pnpm connect:auth           # Production Firebase Auth
pnpm connect:database       # Choose database provider
pnpm connect:deploy         # Cloudflare deployment
pnpm connection:status      # Check current setup
```

## Requirements

- Node.js 20+

The CLI will check and guide all other installation as needed.

## Usage Examples

```bash
# Local development - instant setup
npx create-volo-app my-app

# Production with specific database
npx create-volo-app my-app --database neon
npx create-volo-app my-app --database supabase

# Production Firebase Auth only
npx create-volo-app my-app --auth

# Full production setup
npx create-volo-app my-app --full

# Fast mode (minimal prompts)
npx create-volo-app my-app --full --fast

# Connect to existing project
npx create-volo-app --connect --database --path ./my-app
npx create-volo-app --status --path ./my-app
```

## Local Services

Your local development environment includes:

- **Database**: Embedded PostgreSQL at `./data/postgres`
- **Auth**: Firebase emulator with demo users
- **Frontend**: `http://localhost:5173`
- **API**: `http://localhost:8787`

All data persists locally between development sessions.

## Production Deployment

### Backend (Cloudflare Workers)
```bash
cd server
pnpm run deploy
```

**Set production environment variables** (use `wrangler` for easier management):
```bash
# Recommended: Use wrangler CLI
cd server
wrangler secret put DATABASE_URL
wrangler secret put FIREBASE_PROJECT_ID  
wrangler secret put FIREBASE_PRIVATE_KEY
wrangler secret put FIREBASE_CLIENT_EMAIL

# Alternative: Set in Cloudflare dashboard
# Go to Workers Dashboard > Your Worker > Settings > Variables
```

### Frontend (Cloudflare Pages)

**Manual Setup:**
1. Go to [Cloudflare Pages](https://dash.cloudflare.com/pages) → "Create a project"
2. Connect your Git repository
3. Configure build settings:
   - **Build command**: `pnpm run build`
   - **Output directory**: `ui/dist`
4. Deploy automatically on Git push

**Add your Pages domain to Firebase:**
- Go to Firebase Console → Authentication → Settings → Authorized domains
- Add your `*.pages.dev` domain

### Automated Deployment

For CI/CD, use GitHub Actions or similar with Cloudflare API tokens:
- **Workers**: Use `wrangler deploy` in your pipeline
- **Pages**: Automatic on Git push (or use Cloudflare API)

## Development

```bash
git clone https://github.com/VoloBuilds/create-volo-app.git
cd create-volo-app
pnpm install
pnpm run build
node bin/cli.js test-app
```

## Roadmap
- Make Auth provider modular; support Supabase and Clerk
- Make deployment target more modular (support Docker, different backend TS runtimes like Bun)
- Create UI on top of the CLI for more intuitive project config
- Build optional "commit to git" support to push created volo-app to Git
- Build optional auto-deploy process (git actions + any platform-specific configs)

## Testing

See [`/test`](./test) for testing tools and instructions.

## Support

- 📖 [Documentation](https://github.com/VoloBuilds/volo-app)
- 🐛 [Issues](https://github.com/VoloBuilds/create-volo-app/issues)
- 💬 [Discussions](https://github.com/VoloBuilds/create-volo-app/discussions)

## License

MIT 