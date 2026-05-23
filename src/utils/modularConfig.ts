import fs from 'fs-extra';
import path from 'path';
import { execPnpm } from './cli.js';
import { logger } from './logger.js';
import { ProjectConfig } from '../commands/shared/types.js';

interface ConnectionFlags {
  auth: boolean;
  database: boolean;
  deploy: boolean;
}

export async function generateModularConfigFiles(
  config: ProjectConfig, 
  connectionFlags: ConnectionFlags
): Promise<void> {
  const { directory } = config;

  // Generate server environment file
  await generateModularServerEnv(directory, config, connectionFlags);
  
  // Generate Firebase configuration
  await generateModularFirebaseConfig(directory, config, connectionFlags);
  
  // Generate UI environment for local dev
  await writeLocalUiEnv(directory, config, connectionFlags);
  
  // Generate wrangler configs only if deployment is connected
  if (connectionFlags.deploy) {
    await generateWranglerConfig(directory, config);
    await generateUICloudflareConfig(directory, config.cloudflare.workerName);
    logger.debug('Generated ui/wrangler.toml from template for static assets deployment');
  }
  
  logger.debug('Modular configuration files generated successfully');
}

async function generateModularServerEnv(
  directory: string, 
  config: ProjectConfig, 
  connectionFlags: ConnectionFlags
): Promise<void> {
  const envPath = path.join(directory, 'server', '.env');
  
  let envContent = '';
  
  // Database configuration
  if (connectionFlags.database) {
    envContent += `# Production Database\n`;
    envContent += `DATABASE_URL=${config.database.url}\n\n`;
  } else {
    envContent += `# Local Development Database (embedded PostgreSQL)\n`;
    envContent += `# DATABASE_URL will be set by post-setup script\n\n`;
  }
  
  // Firebase configuration
  if (connectionFlags.auth) {
    envContent += `# Production Firebase Auth\n`;
    envContent += `FIREBASE_PROJECT_ID=${config.firebase.projectId}\n\n`;
  } else {
    envContent += `# Local Firebase Auth (emulator)\n`;
    envContent += `FIREBASE_PROJECT_ID=demo-project\n\n`;
  }
  
  // Anonymous user configuration
  envContent += `# Allow anonymous users (server will accept anonymous Firebase tokens)\n`;
  envContent += `ALLOW_ANONYMOUS_USERS=${config.firebase.allowAnonymous ? 'true' : 'false'}\n\n`;
  
  // Environment setting (local development only)
  if (!connectionFlags.auth) {
    envContent += `# Environment\n`;
    envContent += `NODE_ENV=development\n`;
  }
  
  await fs.ensureDir(path.dirname(envPath));
  await fs.writeFile(envPath, envContent);
  logger.debug('Generated server/.env with modular configuration');
}

async function generateModularFirebaseConfig(
  directory: string, 
  config: ProjectConfig, 
  connectionFlags: ConnectionFlags
): Promise<void> {
  const configPath = path.join(directory, 'ui', 'src', 'lib', 'firebase-config.json');
  
  let firebaseConfig;
  
  if (connectionFlags.auth) {
    // Production Firebase configuration
    firebaseConfig = {
      apiKey: config.firebase.apiKey,
      authDomain: `${config.firebase.projectId}.firebaseapp.com`,
      projectId: config.firebase.projectId,
      storageBucket: `${config.firebase.projectId}.appspot.com`,
      messagingSenderId: config.firebase.messagingSenderId,
      appId: config.firebase.appId,
      measurementId: config.firebase.measurementId
    };
  } else {
    // Local emulator configuration
    firebaseConfig = {
      apiKey: "demo-api-key",
      authDomain: "demo-project.firebaseapp.com",
      projectId: "demo-project",
      storageBucket: "demo-project.appspot.com",
      messagingSenderId: "123456789",
      appId: "1:123456789:web:abcdef123456",
      measurementId: "G-XXXXXXXXXX"
    };
  }
  
  await fs.ensureDir(path.dirname(configPath));
  await fs.writeFile(configPath, JSON.stringify(firebaseConfig, null, 2));
  logger.debug(`Generated Firebase config for ${connectionFlags.auth ? 'production' : 'local emulator'}`);
}

export async function writeLocalUiEnv(
  directory: string, 
  config: ProjectConfig, 
  connectionFlags: ConnectionFlags
): Promise<void> {
  const envPath = path.join(directory, 'ui', '.env.local');
  
  let envContent = '';
  
  // Firebase emulator setting
  if (connectionFlags.auth) {
    envContent += `# Production Firebase Auth\n`;
    envContent += `VITE_USE_FIREBASE_EMULATOR=false\n\n`;
  } else {
    envContent += `# Local Firebase Auth (emulator)\n`;
    envContent += `VITE_USE_FIREBASE_EMULATOR=true\n`;
    envContent += `VITE_FIREBASE_AUTH_EMULATOR_PORT=5503\n\n`;
  }
  
  // Anonymous user configuration
  envContent += `# Allow anonymous users to access app without authentication\n`;
  envContent += `VITE_ALLOW_ANONYMOUS_USERS=${config.firebase.allowAnonymous ? 'true' : 'false'}\n\n`;
  
  // Local API URL — never write production workers.dev URL here
  envContent += `# Local API URL\n`;
  envContent += `VITE_API_URL=http://localhost:5500\n\n`;
  
  await fs.ensureDir(path.dirname(envPath));
  await fs.writeFile(envPath, envContent);
  logger.debug('Generated ui/.env.local with local dev configuration');
}

export async function writeProductionApiUrl(directory: string, apiUrl: string): Promise<void> {
  const envPath = path.join(directory, 'ui', '.env.production');
  const envContent = `# Production API URL\nVITE_API_URL=${apiUrl}\n`;

  await fs.ensureDir(path.dirname(envPath));
  await fs.writeFile(envPath, envContent);
  logger.debug(`Wrote production API URL to ui/.env.production`);
}

/**
 * Generates `ui/wrangler.toml` from the template and adds deploy scripts +
 * wrangler devDependency to `ui/package.json`.  Shared by both initial app
 * creation (`generateModularConfigFiles`) and later `connect:deploy`.
 */
export async function generateUICloudflareConfig(directory: string, workerName: string): Promise<void> {
  const templatePath = path.join(directory, 'ui', 'platforms', 'cloudflare', 'wrangler.toml.template');
  const wranglerPath = path.join(directory, 'ui', 'wrangler.toml');

  const template = await fs.readFile(templatePath, 'utf-8');
  const wranglerConfig = template.replace(/{{WORKER_NAME}}/g, workerName);

  await fs.ensureDir(path.dirname(wranglerPath));
  await fs.writeFile(wranglerPath, wranglerConfig);

  const uiPackageJsonPath = path.join(directory, 'ui', 'package.json');
  if (await fs.pathExists(uiPackageJsonPath)) {
    const packageJson = JSON.parse(await fs.readFile(uiPackageJsonPath, 'utf-8'));
    packageJson.scripts = {
      ...packageJson.scripts,
      'deploy': 'pnpm run build && wrangler deploy',
      'deploy:cf': 'pnpm run deploy',
    };
    packageJson.devDependencies = {
      ...packageJson.devDependencies,
      'wrangler': '^3.0.0',
    };
    await fs.writeFile(uiPackageJsonPath, JSON.stringify(packageJson, null, 2));

    const uiDir = path.join(directory, 'ui');
    await execPnpm(['install'], { cwd: uiDir, stdio: 'pipe' });
    logger.debug('Installed ui dependencies (wrangler)');
  }
}

async function generateWranglerConfig(directory: string, config: ProjectConfig): Promise<void> {
  const templatePath = path.join(directory, 'server', 'platforms', 'cloudflare', 'wrangler.toml.template');
  const wranglerPath = path.join(directory, 'server', 'wrangler.toml');
  
  // Read the template file
  const template = await fs.readFile(templatePath, 'utf-8');
  
  // Replace placeholders with actual values
  const wranglerConfig = template
    .replace(/{{WORKER_NAME}}/g, config.cloudflare.workerName)
    .replace(/{{FIREBASE_PROJECT_ID}}/g, config.firebase.projectId)
    .replace(/{{DATABASE_URL}}/g, config.database.url);

  await fs.ensureDir(path.dirname(wranglerPath));
  await fs.writeFile(wranglerPath, wranglerConfig);
  logger.debug('Generated wrangler.toml from template for production deployment');
} 