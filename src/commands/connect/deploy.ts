import chalk from 'chalk';
import { existsSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import { setupCloudflare } from '../../services/cloudflare.js';
import { 
  createReadlineInterface, 
  question, 
  getProjectNameFromPackageJson,
  confirmProductionSetup,
  confirmReconfiguration
} from './shared.js';
import readline from 'readline';
import { parseEnvFile } from '../../utils/env.js';

export async function connectDeploy(projectPath: string): Promise<void> {
  const rl = createReadlineInterface();
  
  try {
    console.log(chalk.cyan.bold('🚀 Production Deployment Setup'));
    console.log('This will set up production deployment using Cloudflare Workers + Pages.\n');
    
    // Check current deployment configuration
    const currentConfig = await detectCurrentDeploymentConfig(projectPath);
    
    if (currentConfig.isConfigured) {
      console.log(chalk.green('✅ Deployment configuration found'));
      console.log(chalk.gray(`   Worker name: ${currentConfig.workerName}`));
      
      if (!(await confirmReconfiguration(rl, 'deployment settings'))) {
        console.log(chalk.blue('👋 No changes made'));
        return;
      }
    } else {
      console.log(chalk.blue('🆕 Setting up new deployment configuration'));
    }
    
    // Check if using embedded postgres (incompatible with Cloudflare Workers)
    const usingEmbeddedPostgres = await checkForEmbeddedPostgres(projectPath);
    if (usingEmbeddedPostgres) {
      console.log(chalk.red('\n❌ Cannot deploy to Cloudflare Workers with embedded PostgreSQL'));
      console.log(chalk.yellow('Embedded PostgreSQL is Node.js-specific and cannot run in Cloudflare Workers.\n'));
      console.log(chalk.blue('📋 To deploy, you need to connect to a cloud database first:'));
      console.log('   1. Run: pnpm connect:database');
      console.log('   2. Choose a cloud provider (Neon, Supabase, etc.)');
      console.log('   3. Then run pnpm connect:deploy again\n');
      console.log(chalk.gray('💡 This will also remove the embedded-postgres dependency to fix build issues.'));
      return;
    }

    // Confirm before proceeding
    if (!(await confirmProductionSetup(rl, 'production deployment'))) {
      console.log(chalk.blue('👋 Operation cancelled'));
      return;
    }
    
    // Get project name for default worker naming (consistent with createFull.ts)
    const projectName = await getProjectNameFromPackageJson(projectPath);
    
    // Use existing Cloudflare setup from services (fast mode = false for interactive setup)
    console.log(chalk.blue('\n🔐 Setting up Cloudflare...'));
    const cloudflareResult = await setupCloudflare(projectName, false);
    
      // Update wrangler configuration
  await updateWranglerConfig(projectPath, { workerName: cloudflareResult.workerName });
  
  // Note: Using src/api.ts as entry point (already CF Workers compatible)
    
    // Update package.json scripts for Cloudflare development
    await updatePackageJsonForCloudflare(projectPath);
    
    // Set up environment variables
    await setupWorkerEnvironment(projectPath);
    
    // Provide deployment instructions
    await setupPagesDeployment(rl);
    
    console.log(chalk.green('\n🎉 Production deployment setup completed!'));
    console.log(chalk.cyan('\n📋 Next steps:'));
    console.log(`   1. Deploy your API: cd server && pnpm run deploy`);
    console.log('   2. Set up Cloudflare Pages for your frontend (see instructions above)');
    console.log('   3. Update your frontend environment variables with production values');
    console.log('   4. Test your production deployment thoroughly');
    
    console.log(chalk.blue('\n🔧 Useful commands:'));
    console.log('   - Deploy Worker: cd server && pnpm run deploy');
    console.log('   - View Worker logs: cd server && npx wrangler tail');
    console.log('   - Update secrets: cd server && npx wrangler secret put VARIABLE_NAME');
    
  } catch (error) {
    console.error(chalk.red(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  } finally {
    rl.close();
  }
}

async function detectCurrentDeploymentConfig(projectPath: string) {
  const wranglerPath = path.join(projectPath, 'server', 'wrangler.toml');
  
  if (!existsSync(wranglerPath)) {
    return { isConfigured: false, workerName: null };
  }
  
  try {
    const wranglerContent = await readFile(wranglerPath, 'utf-8');
    const nameMatch = wranglerContent.match(/name\s*=\s*["']([^"']+)["']/);
    
    return {
      isConfigured: !!nameMatch,
      workerName: nameMatch?.[1] || null
    };
  } catch (error) {
    return { isConfigured: false, workerName: null };
  }
}

async function updateWranglerConfig(projectPath: string, config: any) {
  const templatePath = path.join(projectPath, 'server', 'platforms', 'cloudflare', 'wrangler.toml.template');
  const wranglerPath = path.join(projectPath, 'server', 'wrangler.toml');
  
  // Read the template file
  let template = await readFile(templatePath, 'utf-8');
  
  // Read all environment variables from .env file
  const envPath = path.join(projectPath, 'server', '.env');
  let allEnvVars: Record<string, string> = {};
  
  if (existsSync(envPath)) {
    const envContent = await readFile(envPath, 'utf-8');
    allEnvVars = parseEnvFile(envContent);
  }
  
  // Replace basic placeholders with actual values
  let wranglerConfig = template
    .replace(/{{WORKER_NAME}}/g, config.workerName)
    .replace(/{{FIREBASE_PROJECT_ID}}/g, allEnvVars.FIREBASE_PROJECT_ID || 'demo-project')
    .replace(/{{DATABASE_URL}}/g, allEnvVars.DATABASE_URL || '');
  
  // Generate complete [vars] section with all environment variables
  const varsSection = generateVarsSection(allEnvVars);
  
  // Replace the [vars] section in the template with the complete one
  wranglerConfig = wranglerConfig.replace(
    /\[vars\][\s\S]*?(?=\n\[|\n#|$)/,
    varsSection
  );

  await writeFile(wranglerPath, wranglerConfig);
  console.log(chalk.green(`✅ Wrangler configuration updated with ${Object.keys(allEnvVars).length} environment variables`));
}

function generateVarsSection(envVars: Record<string, string>): string {
  let varsSection = '[vars]\n';
  
  // Always set RUNTIME to "cloudflare" for Cloudflare Workers
  varsSection += 'RUNTIME = "cloudflare"\n';
  
  // Sort environment variables for consistent output
  const sortedKeys = Object.keys(envVars).sort();
  
  sortedKeys.forEach(key => {
    const value = envVars[key];
    // Skip empty values, NODE_ENV (not needed in CF Workers), and RUNTIME (already handled above)
    if (value && key !== 'NODE_ENV' && key !== 'RUNTIME') {
      // Escape quotes in values
      const escapedValue = value.replace(/"/g, '\\"');
      varsSection += `${key} = "${escapedValue}"\n`;
    }
  });
  
  // If no other variables were added, add a comment
  if (Object.keys(envVars).filter(key => envVars[key] && key !== 'NODE_ENV' && key !== 'RUNTIME').length === 0) {
    varsSection += '# Other environment variables from .env will be added here\n';
  }
  
  return varsSection;
}

// Note: createWorkerEntryPoint removed - using existing api.ts as entry point

async function updatePackageJsonForCloudflare(projectPath: string) {
  const serverPackageJsonPath = path.join(projectPath, 'server', 'package.json');
  
  if (existsSync(serverPackageJsonPath)) {
    const packageJson = JSON.parse(await readFile(serverPackageJsonPath, 'utf-8'));
    
    // Update scripts to use wrangler for development
    // Port is handled by wrangler.toml [dev] section which is updated by port-manager.js
    packageJson.scripts = {
      ...packageJson.scripts,
      'dev': 'wrangler dev --local-protocol http',
      'dev:node': 'tsx watch src/server.ts', // Keep Node.js option available
    };
    
    await writeFile(serverPackageJsonPath, JSON.stringify(packageJson, null, 2));
    console.log(chalk.green('✅ Server package.json updated for Cloudflare development'));
  }
  
  // Also update root package.json to add dev:node fallback script
  const rootPackageJsonPath = path.join(projectPath, 'package.json');
  
  if (existsSync(rootPackageJsonPath)) {
    const packageJson = JSON.parse(await readFile(rootPackageJsonPath, 'utf-8'));
    
    if (packageJson.scripts) {
      packageJson.scripts['dev:node'] = packageJson.scripts.dev
        ? packageJson.scripts.dev.replace('cd server && pnpm dev', 'cd server && pnpm dev:node')
        : 'cd server && pnpm dev:node';
    }
    
    await writeFile(rootPackageJsonPath, JSON.stringify(packageJson, null, 2));
    console.log(chalk.green('✅ Root package.json updated for Cloudflare development'));
  }
}

async function checkForEmbeddedPostgres(projectPath: string): Promise<boolean> {
  // Check if embedded-postgres dependency exists in package.json
  const packageJsonPath = path.join(projectPath, 'server', 'package.json');
  
  if (!existsSync(packageJsonPath)) {
    return false;
  }
  
  try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'));
    const hasEmbeddedPostgres = 
      packageJson.dependencies?.['embedded-postgres'] ||
      packageJson.devDependencies?.['embedded-postgres'];
    
    if (!hasEmbeddedPostgres) {
      return false;
    }
    
    // Also check if DATABASE_URL indicates embedded postgres usage
    const envPath = path.join(projectPath, 'server', '.env');
    if (existsSync(envPath)) {
      const envContent = await readFile(envPath, 'utf-8');
      const envVars = parseEnvFile(envContent);
      const dbUrl = envVars.DATABASE_URL;
      
      // If DATABASE_URL is empty or points to localhost with embedded postgres pattern
      if (!dbUrl || (dbUrl.includes('localhost:') && dbUrl.includes('postgres:password'))) {
        return true;
      }
    } else {
      // No .env file means using default embedded postgres
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('Error checking for embedded postgres:', error);
    return false;
  }
}

async function setupWorkerEnvironment(projectPath: string) {
  console.log(chalk.yellow('\n🔧 Setting up Worker environment variables...'));
  
  // Read current environment variables from .env
  const envPath = path.join(projectPath, 'server', '.env');
  let envVars: Record<string, string> = {};
  
  if (existsSync(envPath)) {
    const envContent = await readFile(envPath, 'utf-8');
    envVars = parseEnvFile(envContent);
  }
  
  // Show required environment variables
  const requiredVars = ['DATABASE_URL', 'FIREBASE_PROJECT_ID'];
  
  console.log(chalk.blue('\n📝 Required environment variables for Worker:'));
  for (const varName of requiredVars) {
    if (envVars[varName]) {
      console.log(chalk.green(`   ✅ ${varName} (found in local .env)`));
    } else {
      console.log(chalk.yellow(`   ⚠️  ${varName} (not found in local .env)`));
    }
  }
  
  console.log(chalk.gray('\n💡 You can set these in your Worker after deployment with:'));
  console.log(chalk.gray('   cd server && npx wrangler secret put VARIABLE_NAME'));
  
  console.log(chalk.green('✅ Worker environment configuration prepared'));
}

async function setupPagesDeployment(rl: readline.Interface) {
  console.log(chalk.cyan('\n📄 Setting up Cloudflare Pages deployment'));
  console.log('For the frontend, you\'ll need to connect your Git repository to Cloudflare Pages.\n');
  
  console.log(chalk.blue('📋 Steps to deploy your frontend:'));
  console.log('1. Push your code to a Git repository (GitHub, GitLab, etc.)');
  console.log('2. Go to https://dash.cloudflare.com/');
  console.log('3. Navigate to "Workers & Pages" > "Create application" > "Pages"');
  console.log('4. Connect your Git repository');
  console.log('5. Configure build settings:');
  console.log('   - Framework preset: Vite');
  console.log('   - Build command: cd ui && pnpm run build');
  console.log('   - Build output directory: ui/dist');
  console.log('6. Add environment variables in Pages settings:');
  console.log('   - Add your Firebase config variables');
  console.log('   - Set VITE_API_URL to your Worker URL\n');
  
  const shouldOpenDashboard = await question(rl, 'Would you like to open Cloudflare Dashboard to set up Pages? (y/N): ');
  
  if (shouldOpenDashboard.toLowerCase() === 'y') {
    try {
      const { default: open } = await import('open');
      await open('https://dash.cloudflare.com/');
      console.log(chalk.green('🌐 Opened Cloudflare Dashboard in your browser'));
    } catch (error) {
      console.log(chalk.blue('Please visit: https://dash.cloudflare.com/'));
    }
  }
} 