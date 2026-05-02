import fs from 'fs-extra';
import path from 'path';
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
  
  // Generate UI environment for emulator settings
  await generateModularUIEnv(directory, config, connectionFlags);
  
  // Generate wrangler config only if deployment is connected
  if (connectionFlags.deploy) {
    await generateWranglerConfig(directory, config);
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
  
  // Environment setting
  envContent += `# Environment\n`;
  envContent += `NODE_ENV=development\n`;
  
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

async function generateModularUIEnv(
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
    envContent += `VITE_USE_FIREBASE_EMULATOR=true\n\n`;
  }
  
  // Anonymous user configuration
  envContent += `# Allow anonymous users to access app without authentication\n`;
  envContent += `VITE_ALLOW_ANONYMOUS_USERS=${config.firebase.allowAnonymous ? 'true' : 'false'}\n\n`;
  
  // API URL setting
  if (connectionFlags.deploy) {
    envContent += `# Production API URL (will be set during deployment)\n`;
    envContent += `# VITE_API_URL=https://${config.cloudflare.workerName}.YOUR_SUBDOMAIN.workers.dev\n\n`;
  } else {
    envContent += `# Local API URL\n`;
    envContent += `VITE_API_URL=http://localhost:8787\n\n`;
  }
  
  await fs.ensureDir(path.dirname(envPath));
  await fs.writeFile(envPath, envContent);
  logger.debug('Generated ui/.env.local with modular configuration');
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