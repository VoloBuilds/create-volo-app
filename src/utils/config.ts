import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import inquirer from 'inquirer';
import Ajv from 'ajv';
import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  };
}

let cachedValidate: ReturnType<Ajv['compile']> | null = null;

function getSchemaValidator(): ReturnType<Ajv['compile']> | null {
  if (cachedValidate !== null) return cachedValidate;

  // Resolve schema relative to the package root (two levels up from dist/utils/)
  const schemaPath = path.resolve(__dirname, '..', '..', 'volo-config.schema.json');
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

export function discoverConfig(): string | null {
  const configPath = path.join(process.cwd(), 'volo-config.json');

  // Safety guard: don't auto-discover if we're in the create-volo-app repo itself
  const cliMarker = path.join(process.cwd(), 'bin', 'cli.js');
  if (fs.existsSync(cliMarker)) {
    return null;
  }

  if (fs.existsSync(configPath)) {
    return configPath;
  }

  return null;
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
    $schema: 'https://raw.githubusercontent.com/VoloBuilds/create-volo-app/main/volo-config.schema.json'
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
          default: `${projectName}-db`
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
        default: `${projectName}-api`
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
  logger.info(`Usage: npx create-volo-app ${config.projectName} --config ./volo-config.json`);
  console.log('');
}
