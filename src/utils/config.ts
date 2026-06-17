import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import inquirer from 'inquirer';
import Ajv from 'ajv';
import { logger } from './logger.js';
import { deriveServiceSlug } from './validation.js';

const require = createRequire(import.meta.url);
const { version: packageVersion } = require('../../package.json') as { version: string };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getPublishedConfigSchemaUrl(version: string = packageVersion): string {
  return `https://raw.githubusercontent.com/VoloBuilds/create-volo-app/v${version}/volo-config.schema.json`;
}

export function getPublishedExampleConfigUrl(
  filename: string,
  version: string = packageVersion
): string {
  return `https://raw.githubusercontent.com/VoloBuilds/create-volo-app/v${version}/examples/${filename}`;
}

function getBundledConfigSchemaPath(): string {
  return path.resolve(__dirname, '..', '..', 'volo-config.schema.json');
}

function loadBundledConfigSchema(): Record<string, unknown> {
  const schemaPath = getBundledConfigSchemaPath();
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`Bundled config schema not found at ${schemaPath}`);
  }
  return JSON.parse(fs.readFileSync(schemaPath, 'utf-8')) as Record<string, unknown>;
}

export function printConfigHelp(): void {
  const schemaUrl = getPublishedConfigSchemaUrl();
  const examples = [
    'volo-config.local.json',
    'volo-config.production.json',
    'volo-config.new-project.json',
  ] as const;

  const lines = [
    `create-volo-app config reference (v${packageVersion})`,
    '',
    'CONFIG MODE',
    '---------',
    'npx create-volo-app --config ./volo-config.json',
    'npx create-volo-app my-app --config ./volo-config.json',
    '',
    'Pass --config explicitly (bare flag defaults to ./volo-config.json in cwd).',
    'Generate a starter file interactively: npx create-volo-app --init-config',
    '',
    'REQUIRED FIELDS (non-interactive)',
    '---------------------------------',
    '- projectName: target directory name (used when the CLI positional is omitted)',
    '- database.action ("create" | "existing"): required when a database block is present',
    '',
    'SCHEMA-ENFORCED CONDITIONALS',
    '-----------------------------',
    '- auth.projectId: required when auth.action is "existing"',
    '- database.projectName: required when database.action is "existing" and provider is neon or supabase',
    '- database.connectionString: required when database.action is "existing" and provider is "other"',
    '',
    'SERVICE BLOCKS (CLI EQUIVALENTS)',
    '--------------------------------',
    '- auth: implies --auth (Firebase Authentication)',
    '- database: implies --database <provider> (neon | supabase | other)',
    '- deploy: implies --deploy cloudflare (provider defaults to "cloudflare")',
    '',
    'options.skipPrereqs — skip prerequisite checks',
    'options.verbose — enable verbose logging',
    'options.template — template URL or local path (#branch for branch); CLI --template wins if passed',
    'options.overwrite — allow replacing an existing target directory (default: false)',
    '',
    'NON-INTERACTIVE AUTH RULES',
    '--------------------------',
    'Config mode never opens browser auth prompts. Pre-authenticate required CLIs before running,',
    'or supply credentials in the config:',
    '  - Firebase (auth): firebase login — or auth.projectId for an existing project',
    '  - Neon (database.provider neon): neonctl auth — or database.connectionString',
    '  - Supabase (database.provider supabase): supabase login — or database.connectionString',
    '  - Cloudflare (deploy): wrangler login',
    '',
    'If authentication is still needed when --config runs, the CLI fails immediately.',
    'Service setup does not retry in config mode. Manual Neon/Supabase fallbacks are disabled;',
    'use connectionString or an authenticated CLI.',
    '',
    'EXAMPLE CONFIGS',
    '---------------',
    ...examples.flatMap((name) => [
      `https://github.com/VoloBuilds/create-volo-app/blob/v${packageVersion}/examples/${name}`,
      getPublishedExampleConfigUrl(name),
    ]),
    '',
    'SCHEMA URL (for $schema in volo-config.json)',
    '--------------------------------------------',
    schemaUrl,
    '',
    'MINIMAL LOCAL EXAMPLE',
    '---------------------',
    JSON.stringify(
      {
        $schema: schemaUrl,
        projectName: 'my-app',
        options: { skipPrereqs: true, template: '/path/to/volo-app' },
      },
      null,
      2
    ),
    '',
    '--- volo-config.schema.json ---',
    JSON.stringify(loadBundledConfigSchema(), null, 2),
    '--- end volo-config.schema.json ---',
    '',
  ];

  console.log(lines.join('\n'));
}

export interface VoloConfig {
  $schema?: string;
  projectName?: string;

  auth?: {
    action: 'create' | 'existing';
    projectId?: string;
    displayName?: string;
    allowAnonymous?: boolean;
    setupGoogleSignIn?: boolean;
  };

  database?: {
    provider: 'neon' | 'supabase' | 'other';
    action?: 'create' | 'existing';
    projectName?: string;
    connectionString?: string;
  };

  deploy?: {
    provider?: 'cloudflare';
    workerName?: string;
  };

  options?: {
    skipPrereqs?: boolean;
    verbose?: boolean;
    template?: string;
    /** When true, replace an existing target directory in config mode. Defaults to false. */
    overwrite?: boolean;
  };
}

let cachedValidate: ReturnType<Ajv['compile']> | null = null;

function getSchemaValidator(): ReturnType<Ajv['compile']> | null {
  if (cachedValidate !== null) return cachedValidate;

  const schemaPath = getBundledConfigSchemaPath();
  if (!fs.existsSync(schemaPath)) {
    logger.debug(`Schema file not found at ${schemaPath}, skipping schema validation`);
    return null;
  }

  try {
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
    const ajv = new Ajv({ allErrors: true });
    cachedValidate = ajv.compile(schema);
    return cachedValidate;
  } catch (error) {
    logger.debug(`Failed to compile config schema: ${error}`);
    return null;
  }
}

function formatValidationErrors(errors: NonNullable<ReturnType<Ajv['compile']>['errors']>): string {
  return errors
    .map(err => {
      const field = err.instancePath || '(root)';
      if (err.keyword === 'additionalProperties') {
        return `${field}: unknown property "${(err.params as any).additionalProperty}"`;
      }
      return `${field}: ${err.message}`;
    })
    .join('\n  ');
}

export function loadConfig(configPath: string): VoloConfig {
  const resolvedPath = path.resolve(configPath);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Config file not found: ${resolvedPath}`);
  }

  let config: VoloConfig;
  try {
    const content = fs.readFileSync(resolvedPath, 'utf-8');
    config = JSON.parse(content) as VoloConfig;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Invalid JSON in config file: ${resolvedPath}`);
    }
    throw error;
  }

  const validate = getSchemaValidator();
  if (validate && !validate(config)) {
    const details = formatValidationErrors(validate.errors!);
    throw new Error(`Invalid config file (${resolvedPath}):\n  ${details}`);
  }

  return config;
}

export function validateConfigForNonInteractive(config: VoloConfig): void {
  if (!config.projectName?.trim()) {
    throw new Error(
      'volo-config.json must include "projectName" for non-interactive setup.'
    );
  }

  if (config.database && !config.database.action) {
    throw new Error(
      'volo-config.json must include database.action ("create" or "existing") when database is configured.'
    );
  }
}

interface CreateOptionsLike {
  template?: string;
  fast?: boolean;
  verbose?: boolean;
  full?: boolean;
  auth?: boolean | string;
  database?: boolean | string;
  deploy?: boolean | string;
  config?: string;
  initConfig?: boolean;
  configData?: VoloConfig;
}

export interface MergeConfigOptions {
  /** True when the user passed `--template` on the CLI (not the post-merge default). */
  templateFromCli?: boolean;
}

export function mergeConfigWithOptions(
  config: VoloConfig,
  cliOptions: CreateOptionsLike,
  mergeOptions?: MergeConfigOptions
): CreateOptionsLike {
  const merged = { ...cliOptions };

  // Config values are used only when CLI flags are not explicitly set

  // Template: explicit CLI --template wins; otherwise use config.options.template
  if (config.options?.template && !mergeOptions?.templateFromCli) {
    merged.template = config.options.template;
  }

  // Verbose
  if (config.options?.verbose && !cliOptions.verbose) {
    merged.verbose = true;
  }

  // Auth: presence of config.auth implies --auth
  if (config.auth && cliOptions.auth === undefined) {
    merged.auth = true;
  }

  // Database: presence of config.database implies --database with provider
  if (config.database && cliOptions.database === undefined) {
    merged.database = config.database.provider;
  }

  // Deploy: presence of config.deploy implies --deploy with provider
  if (config.deploy && cliOptions.deploy === undefined) {
    merged.deploy = config.deploy.provider || 'cloudflare';
  }

  // Store the config data for downstream use
  merged.configData = config;

  return merged;
}

export async function generateConfigInteractively(): Promise<void> {
  console.log('');
  logger.step('Generating volo-config.json...');
  console.log('');

  const config: VoloConfig = {
    $schema: getPublishedConfigSchemaUrl(),
  };

  // Project name
  const { projectName } = await inquirer.prompt([
    {
      type: 'input',
      name: 'projectName',
      message: 'What will your project be called?',
      default: 'my-volo-app',
      validate: (input: string) => input.trim() ? true : 'Project name is required'
    }
  ]);
  config.projectName = projectName;
  const serviceSlug = deriveServiceSlug(projectName);

  // Auth setup
  const { setupAuth } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'setupAuth',
      message: 'Set up production authentication (Firebase)?',
      default: false
    }
  ]);

  if (setupAuth) {
    const { authAction } = await inquirer.prompt([
      {
        type: 'list',
        name: 'authAction',
        message: 'Create a new Firebase project or use an existing one?',
        choices: [
          { name: 'Create a new Firebase project', value: 'create' },
          { name: 'Use an existing Firebase project', value: 'existing' }
        ]
      }
    ]);

    config.auth = { action: authAction };

    if (authAction === 'existing') {
      const { projectId } = await inquirer.prompt([
        {
          type: 'input',
          name: 'projectId',
          message: 'Enter your Firebase project ID:',
          validate: (input: string) => input.trim() ? true : 'Project ID is required'
        }
      ]);
      config.auth.projectId = projectId;
    }

    const { setupGoogleSignIn } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'setupGoogleSignIn',
        message: 'Set up Google Sign-In?',
        default: true
      }
    ]);
    config.auth.setupGoogleSignIn = setupGoogleSignIn;

    const { allowAnonymous } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'allowAnonymous',
        message: 'Allow anonymous users to access the app before signing in?',
        default: false
      }
    ]);
    config.auth.allowAnonymous = allowAnonymous;
  }

  // Database setup
  const { setupDatabase } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'setupDatabase',
      message: 'Set up a production database?',
      default: false
    }
  ]);

  if (setupDatabase) {
    const { dbProvider } = await inquirer.prompt([
      {
        type: 'list',
        name: 'dbProvider',
        message: 'Which database provider?',
        choices: [
          { name: 'Neon', value: 'neon' },
          { name: 'Supabase', value: 'supabase' },
          { name: 'Other PostgreSQL (I have a connection string)', value: 'other' }
        ]
      }
    ]);

    config.database = { provider: dbProvider };

    const { dbAction } = await inquirer.prompt([
      {
        type: 'list',
        name: 'dbAction',
        message: 'Create a new database project or use an existing one?',
        choices: [
          { name: 'Create a new project', value: 'create' },
          { name: 'Use an existing project', value: 'existing' }
        ]
      }
    ]);
    config.database.action = dbAction;

    if (dbAction === 'create') {
      const { dbProjectName } = await inquirer.prompt([
        {
          type: 'input',
          name: 'dbProjectName',
          message: 'Enter a name for your database project:',
          default: `${serviceSlug}-db`
        }
      ]);
      config.database.projectName = dbProjectName;
    } else {
      if (dbProvider === 'other') {
        const { connectionString } = await inquirer.prompt([
          {
            type: 'input',
            name: 'connectionString',
            message: 'Enter your PostgreSQL connection string:',
            validate: (input: string) => {
              if (!input.trim()) return 'Connection string is required';
              if (!input.startsWith('postgresql://') && !input.startsWith('postgres://')) {
                return 'Connection string should start with "postgresql://" or "postgres://"';
              }
              return true;
            }
          }
        ]);
        config.database.connectionString = connectionString;
      } else {
        const { dbProjectName } = await inquirer.prompt([
          {
            type: 'input',
            name: 'dbProjectName',
            message: 'Enter the name or ID of your existing database project:',
            validate: (input: string) => input.trim() ? true : 'Project name is required'
          }
        ]);
        config.database.projectName = dbProjectName;
      }
    }
  }

  // Deploy setup
  const { setupDeploy } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'setupDeploy',
      message: 'Set up production deployment (Cloudflare)?',
      default: false
    }
  ]);

  if (setupDeploy) {
    config.deploy = { provider: 'cloudflare' };

    const { workerName } = await inquirer.prompt([
      {
        type: 'input',
        name: 'workerName',
        message: 'Enter a name for your Cloudflare Worker:',
        default: `${serviceSlug}-api`
      }
    ]);
    config.deploy.workerName = workerName;
  }

  // Write the config file (with overwrite confirmation)
  const outputPath = path.join(process.cwd(), 'volo-config.json');

  if (fs.existsSync(outputPath)) {
    const { overwrite } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'overwrite',
        message: 'volo-config.json already exists. Overwrite it?',
        default: false
      }
    ]);

    if (!overwrite) {
      logger.info('Config generation cancelled.');
      return;
    }
  }

  await fs.writeJson(outputPath, config, { spaces: 2 });

  console.log('');
  logger.success(`Config written to ./volo-config.json`);
  logger.warning(
    'This file may contain secrets — do not commit it. Use examples/ for safe samples; in CI, generate the file from injected secrets.'
  );
  logger.info(`Usage: npx create-volo-app ${config.projectName} --config ./volo-config.json`);
  console.log('');
}
