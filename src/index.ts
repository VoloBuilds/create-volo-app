#!/usr/bin/env node

import { Command } from 'commander';
import path from 'path';
import chalk from 'chalk';
import { createRequire } from 'module';
import { createApp } from './commands/createApp.js';
import { checkPrerequisites } from './utils/prerequisites/checkPrereqs.js';
import { logger } from './utils/logger.js';
import { connectToService } from './commands/connect/index.js';
import { showConnectionStatus } from './commands/connect/status.js';
import { loadConfig, mergeConfigWithOptions, generateConfigInteractively, validateConfigForNonInteractive } from './utils/config.js';
import { assertNoDeprecatedCliFlags } from './utils/deprecatedFlags.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

const program = new Command();

// Default template (branch is embedded as #fragment; parseTemplateArg() splits it).
const DEFAULT_TEMPLATE = 'https://github.com/VoloBuilds/volo-app.git#release/v0.4.0';

export async function main() {
  try {
    assertNoDeprecatedCliFlags();

    program
    .name('create-volo-app')
    .description('CLI tool to create a new Volo app with flexible local-first or production setup')
    .version(version)
    .argument('[project-name]', 'Project name or path (relative/absolute)')
    .option('-t, --template <url-or-path>', 'Custom template (GitHub URL or local path; append #branch for branch)')
    .option('--fast', 'Fast mode: use smart defaults and minimal prompts')
    .option('--verbose', 'Enable verbose logging')
    .option('--full', 'Full production setup: authenticate with all services')
    .option('--connect', 'Connect services to existing project mode')
    .option('--auth [provider]', 'Setup production Firebase Auth (creation) or connect to existing project')
    .option('--database [provider]', 'Setup production database (creation) or connect to existing project (neon, supabase, custom)')
    .option('--deploy [provider]', 'Production deployment setup (default: cloudflare)')
    .option('--config [path]', 'Use volo-config.json for non-interactive setup (defaults to ./volo-config.json in cwd)')
    .option('--init-config', 'Generate a volo-config.json via interactive wizard')
    .addHelpText('after', `
Examples:
  # Local development (default)
  npx create-volo-app my-app

  # Use a relative or absolute path
  npx create-volo-app ../my-app
  npx create-volo-app /tmp/my-app

  # Full production setup
  npx create-volo-app my-app --full

  # Full production, minimal prompts
  npx create-volo-app my-app --full --fast

  # Modular: production database + local auth/deploy
  npx create-volo-app my-app --database neon

  # Config-driven setup (non-interactive; reads ./volo-config.json in cwd)
  npx create-volo-app --config

  # Config-driven setup with explicit path
  npx create-volo-app --config ./volo-config.json

  # Generate a config file
  npx create-volo-app --init-config

  # Connect a service to existing project (run from project dir)
  npx create-volo-app --connect --auth

  # Show connection status (run from project dir)
  npx create-volo-app --connect
    `)
    .action(async (projectName: string | undefined, options, command) => {
      try {
        logger.setVerbose(options.verbose);

        // Handle --init-config: generate config file and exit
        if (options.initConfig) {
          await generateConfigInteractively();
          return;
        }

        // Connection mode - work with existing project in cwd
        if (options.connect) {
          const targetPath = process.cwd();

          if (options.auth) {
            const provider = typeof options.auth === 'string' ? options.auth : undefined;
            await connectToService('auth', targetPath, provider);
          } else if (options.database) {
            const provider = typeof options.database === 'string' ? options.database : undefined;
            await connectToService('database', targetPath, provider);
          } else if (options.deploy) {
            const provider = typeof options.deploy === 'string' ? options.deploy : undefined;
            await connectToService('deploy', targetPath, provider);
          } else {
            await showConnectionStatus(targetPath);
          }

          return;
        }

        // Load config file when --config is provided
        let configData;
        if (options.config !== undefined) {
          const configPath =
            typeof options.config === 'string' && options.config.trim()
              ? options.config
              : path.join(process.cwd(), 'volo-config.json');
          configData = loadConfig(configPath);
          validateConfigForNonInteractive(configData);
          logger.info(`Using config: ${configPath}`);
        }

        if (configData) {
          const templateFromCli = command.getOptionValueSource('template') === 'cli';
          const merged = mergeConfigWithOptions(configData, options, { templateFromCli });
          Object.assign(options, merged);
          if (!projectName && configData.projectName) {
            projectName = configData.projectName;
          }
        }

        // Apply default template after config merge so config.options.template can take effect
        if (!options.template) {
          options.template = DEFAULT_TEMPLATE;
        }

        // Project creation mode
        console.log(chalk.cyan.bold('🚀 Welcome to create-volo-app!'));
        console.log('');

        const skipPrereqs = configData?.options?.skipPrereqs === true;
        if (!skipPrereqs) {
          await checkPrerequisites({
            autoInstall: !!options.fast || !!configData,
            fastMode: options.fast || !!configData,
            productionMode: !!(options.auth || options.database || options.deploy || options.full),
            databasePreference: typeof options.database === 'string' ? options.database : undefined
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
  } catch (error) {
    console.error(chalk.red('❌ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
