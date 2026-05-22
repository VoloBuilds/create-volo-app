# Testing create-volo-app

This directory contains testing tools for the CLI.

## Structure

- **`verify-setup.js`** - Check if required development tools are installed locally
- **`docker/`** - Test CLI installation and dependency management in clean environments

## Quick Commands

```bash
# Check local environment
npm run verify

# Test in Docker
npm run test:docker

# End-to-end smoke test against a local volo-app template (from repo root)
pnpm test:volo-flow
pnpm test:volo-flow:dev
pnpm test:volo-flow:stop
pnpm test:volo-flow:cleanup
```

For detailed testing instructions, see the README files in each directory. 