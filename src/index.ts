#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { createApp } from './commands/createApp.js';
import { checkPrerequisites } from './utils/prerequisites/checkPrereqs.js';
import { logger } from './utils/logger.js';
import { connectToService } from './commands/connect/index.js';
import { showConnectionStatus } from './commands/connect/status.js';

const program = new Command();

// Default template URL
const DEFAULT_TEMPLATE = 'https://github.com/VoloBuilds/volo-app.git';
const VOLO_APP_BRANCH = 'release/v0.3.2';

export async function main() {
  program
    .name('create-volo-app')
    .description('CLI tool to create a new Volo app with flexible local-first or production setup')
    .version('1.0.0')
    .argument('[project-name]', 'Name of the project to create')
    .option('-t, --template <url>', 'Custom template repository URL', DEFAULT_TEMPLATE)
    .option('-b, --branch <branch>', 'Git branch to clone from template repository', VOLO_APP_BRANCH)
    .option('--db <provider>', 'Database provider (neon, supabase, other)')
    .option('--fast', 'Fast mode: use smart defaults and minimal prompts')
    .option('--skip-prereqs', 'Skip prerequisite checks (advanced users only)')
    .option('--install-deps', 'Automatically install missing dependencies without prompting')
    .option('--verbose', 'Enable verbose logging')
    .option('--full', 'Full production setup: authenticate with all services')
    .option('--path <path>', 'Path to volo-app project (for connection commands)')
    .option('--connect', 'Connect services to existing project mode')
    .option('--auth [provider]', 'Setup production Firebase Auth (creation) or connect to existing project')
    .option('--database [provider]', 'Setup production database (creation) or connect to existing project (neon, supabase, custom)')
    .option('--deploy', 'Setup production deployment (creation) or connect to existing project')
    .option('--status', 'Show connection status')
    .addHelpText('after', `
Examples:
  # Default: local development (no auth required)
  npx create-volo-app my-app

  # Create in current directory
  npx create-volo-app .

  # Full production setup
  npx create-volo-app my-app --full
  
  # Modular creation: production database + local auth/deploy
  npx create-volo-app my-app --database neon
  
  # Production Firebase + local database/deploy
  npx create-volo-app my-app --auth
  
  # Connect services to existing project
  npx create-volo-app --connect --database --path ./my-app
  npx create-volo-app --connect --auth --path ./my-app
  npx create-volo-app --status --path ./my-app
    `)
    .action(async (projectName: string | undefined, options) => {
      try {
        logger.setVerbose(options.verbose);

        // Check if this is connection mode
        if (options.connect || (options.status && !projectName)) {
          // Connection mode - work with existing project
          const targetPath = options.path || process.cwd();
          
          if (options.status) {
            await showConnectionStatus(targetPath);
          } else if (options.auth) {
            const provider = typeof options.auth === 'string' ? options.auth : undefined;
            await connectToService('auth', targetPath, provider);
          } else if (options.database) {
            const provider = typeof options.database === 'string' ? options.database : undefined;
            await connectToService('database', targetPath, provider);
          } else if (options.deploy) {
            await connectToService('deploy', targetPath);
          } else {
            console.error(chalk.red('❌ Error: --connect requires a service flag (--auth, --database, or --deploy)'));
            process.exit(1);
          }
          
          return;
        }

        // Project creation mode
        console.log(chalk.cyan.bold('🚀 Welcome to create-volo-app!'));
        console.log('');

        // Check prerequisites unless skipped
        // Always check core tools (pnpm, git, node), and additional tools only for production services
        if (!options.skipPrereqs) {
          await checkPrerequisites({
            autoInstall: options.installDeps,
            fastMode: options.fast,
            // For local mode, only check core prerequisites (pnpm, git, node)
            // For production mode, check all relevant service CLIs too
            productionMode: !!(options.auth || options.database || options.deploy || options.full)
          });
        }

        // Create the app
        await createApp(projectName, options);

      } catch (error) {
        console.error(chalk.red('❌ Error:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  await program.parseAsync();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
} 