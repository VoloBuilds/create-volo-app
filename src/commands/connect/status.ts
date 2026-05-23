import chalk from 'chalk';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';

export async function showConnectionStatus(projectPath: string): Promise<void> {
  console.log(chalk.cyan.bold('🔍 VoLo App - Production Connection Status\n'));
  
  // Check all services
  const [firebaseStatus, databaseStatus, deploymentStatus] = await Promise.all([
    checkFirebaseStatus(projectPath),
    checkDatabaseStatus(projectPath),
    checkDeploymentStatus(projectPath)
  ]);
  
  // Display results
  console.log('📊 Service Status:');
  console.log('┌─────────────────┬──────────────────────────────────────┐');
  console.log('│ Service         │ Status                               │');
  console.log('├─────────────────┼──────────────────────────────────────┤');
  
  // Firebase Auth
  const firebaseStatusText = getStatusText(firebaseStatus.status, firebaseStatus.mode);
  console.log(`│ ${getStatusIcon(firebaseStatus.status)} Firebase Auth │ ${firebaseStatusText.padEnd(30)} │`);
  if (firebaseStatus.projectId) {
    console.log(`│                 │ Project: ${firebaseStatus.projectId.padEnd(23)} │`);
  }
  
  console.log('├─────────────────┼──────────────────────────────────────┤');
  
  // Database
  const databaseStatusText = getStatusText(databaseStatus.status, databaseStatus.mode);
  console.log(`│ ${getStatusIcon(databaseStatus.status)} Database       │ ${databaseStatusText.padEnd(30)} │`);
  if (databaseStatus.url) {
    const truncatedUrl = databaseStatus.url.length > 30 ? databaseStatus.url.substring(0, 27) + '...' : databaseStatus.url;
    console.log(`│                 │ ${truncatedUrl.padEnd(30)} │`);
  }
  
  console.log('├─────────────────┼──────────────────────────────────────┤');
  
  // Deployment
  const deploymentStatusText = getStatusText(deploymentStatus.status, deploymentStatus.mode);
  console.log(`│ ${getStatusIcon(deploymentStatus.status)} Deployment    │ ${deploymentStatusText.padEnd(30)} │`);
  if (deploymentStatus.workerName) {
    console.log(`│                 │ Worker: ${deploymentStatus.workerName.padEnd(24)} │`);
  }
  
  console.log('└─────────────────┴──────────────────────────────────────┘\n');
  
  const commands = await getConnectCommandHints(projectPath);

  // Show connection commands
  console.log(chalk.cyan('🔧 Available Connection Commands:'));
  if (!commands.usePackageScripts) {
    console.log(chalk.gray('   (Run from your project directory)'));
  }

  if (firebaseStatus.status === 'local') {
    console.log(`   ${chalk.yellow(commands.auth)}              - Connect to production Firebase Auth`);
  } else {
    console.log(`   ${chalk.green(commands.auth)}              - Reconfigure Firebase Auth (currently production)`);
  }

  if (databaseStatus.status === 'local') {
    console.log(`   ${chalk.yellow(commands.database)}          - Connect to production database`);
    console.log(`   ${chalk.yellow(commands.databaseNeon)}     - Connect to Neon specifically`);
    console.log(`   ${chalk.yellow(commands.databaseSupabase)} - Connect to Supabase specifically`);
  } else {
    console.log(`   ${chalk.green(commands.database)}          - Reconfigure database (currently production)`);
  }

  if (deploymentStatus.status === 'local') {
    console.log(`   ${chalk.yellow(commands.deploy)}            - Set up production deployment`);
  } else {
    console.log(`   ${chalk.green(commands.deploy)}            - Reconfigure deployment (currently production)`);
  }

  console.log(`   ${chalk.blue(commands.status)}          - Show this status (current command)`);
  
  // Summary and recommendations
  const productionCount = [firebaseStatus, databaseStatus, deploymentStatus]
    .filter(s => s.status === 'production').length;
  
  console.log(chalk.cyan('\n📋 Summary:'));
  
  if (productionCount === 0) {
    console.log(chalk.blue('   🏠 Full local development setup - ready for prototyping!'));
    console.log('   💡 Run connection commands above to upgrade to production when ready');
  } else if (productionCount === 3) {
    console.log(chalk.green('   🌐 Full production setup - ready for deployment!'));
    console.log('   🚀 Your app is configured for production use');
  } else {
    console.log(chalk.yellow('   🔄 Hybrid setup - some services are production, others local'));
    console.log('   📈 Consider connecting remaining services for full production setup');
  }
}

interface ConnectCommandHints {
  usePackageScripts: boolean;
  auth: string;
  database: string;
  databaseNeon: string;
  databaseSupabase: string;
  deploy: string;
  status: string;
}

async function getConnectCommandHints(projectPath: string): Promise<ConnectCommandHints> {
  const packageJsonPath = path.join(projectPath, 'package.json');
  let hasConnectScripts = false;

  if (existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'));
      hasConnectScripts = Boolean(packageJson.scripts?.['connect:auth']);
    } catch {
      hasConnectScripts = false;
    }
  }

  if (hasConnectScripts) {
    return {
      usePackageScripts: true,
      auth: 'pnpm connect:auth',
      database: 'pnpm connect:database',
      databaseNeon: 'pnpm connect:database:neon',
      databaseSupabase: 'pnpm connect:database:supabase',
      deploy: 'pnpm connect:deploy',
      status: 'pnpm connection:status',
    };
  }

  return {
    usePackageScripts: false,
    auth: 'npx create-volo-app --connect --auth',
    database: 'npx create-volo-app --connect --database',
    databaseNeon: 'npx create-volo-app --connect --database neon',
    databaseSupabase: 'npx create-volo-app --connect --database supabase',
    deploy: 'npx create-volo-app --connect --deploy',
    status: 'npx create-volo-app --connect',
  };
}

async function checkFirebaseStatus(projectPath: string) {
  const configPath = path.join(projectPath, 'ui', 'src', 'lib', 'firebase-config.json');
  
  if (!existsSync(configPath)) {
    return { status: 'not_configured', mode: 'none' };
  }
  
  try {
    const config = JSON.parse(await readFile(configPath, 'utf-8'));
    
    if (config.projectId === 'demo-project') {
      return { 
        status: 'local', 
        mode: 'emulator',
        projectId: config.projectId 
      };
    } else {
      return { 
        status: 'production', 
        mode: 'production',
        projectId: config.projectId 
      };
    }
  } catch (error) {
    return { status: 'error', mode: 'invalid', error: error instanceof Error ? error.message : String(error) };
  }
}

async function checkDatabaseStatus(projectPath: string) {
  const envPath = path.join(projectPath, 'server', '.env');
  
  if (!existsSync(envPath)) {
    return { status: 'not_configured', mode: 'none' };
  }
  
  try {
    const envContent = await readFile(envPath, 'utf-8');
    const dbUrlMatch = envContent.match(/DATABASE_URL=(.+)/);
    
    if (!dbUrlMatch) {
      return { status: 'not_configured', mode: 'none' };
    }
    
    const connectionString = dbUrlMatch[1].trim();
    
    if (connectionString.includes('localhost') || connectionString.includes('127.0.0.1')) {
      return { 
        status: 'local', 
        mode: 'embedded',
        url: connectionString.replace(/:[^:@]*@/, ':****@')
      };
    } else if (connectionString.includes('neon.tech')) {
      return { 
        status: 'production', 
        mode: 'neon',
        url: connectionString.replace(/:[^:@]*@/, ':****@')
      };
    } else if (connectionString.includes('supabase.')) {
      return { 
        status: 'production', 
        mode: 'supabase',
        url: connectionString.replace(/:[^:@]*@/, ':****@')
      };
    } else {
      return { 
        status: 'production', 
        mode: 'custom',
        url: connectionString.replace(/:[^:@]*@/, ':****@')
      };
    }
  } catch (error) {
    return { status: 'error', mode: 'invalid', error: error instanceof Error ? error.message : String(error) };
  }
}

async function checkDeploymentStatus(projectPath: string) {
  const serverWranglerPath = path.join(projectPath, 'server', 'wrangler.toml');
  const uiWranglerPath = path.join(projectPath, 'ui', 'wrangler.toml');
  const uiPackageJsonPath = path.join(projectPath, 'ui', 'package.json');

  const hasServerWrangler = existsSync(serverWranglerPath);
  const hasUiWrangler = existsSync(uiWranglerPath);

  if (!hasServerWrangler && !hasUiWrangler) {
    return { status: 'not_configured', mode: 'local' };
  }

  let hasDeployScript = false;
  if (existsSync(uiPackageJsonPath)) {
    try {
      const packageJson = JSON.parse(await readFile(uiPackageJsonPath, 'utf-8'));
      hasDeployScript = Boolean(packageJson.scripts?.deploy);
    } catch {
      hasDeployScript = false;
    }
  }

  if (!hasDeployScript) {
    return { status: 'partial', mode: 'incomplete' };
  }

  try {
    const wranglerPath = hasServerWrangler ? serverWranglerPath : uiWranglerPath;
    const wranglerContent = await readFile(wranglerPath, 'utf-8');
    const nameMatch = wranglerContent.match(/name\s*=\s*["']([^"']+)["']/);

    return {
      status: 'production',
      mode: 'cloudflare',
      workerName: nameMatch?.[1]
    };
  } catch (error) {
    return { status: 'error', mode: 'invalid', error: error instanceof Error ? error.message : String(error) };
  }
}

function getStatusIcon(status: string): string {
  switch (status) {
    case 'production': return chalk.green('🌐');
    case 'local': return chalk.blue('🏠');
    case 'not_configured': return chalk.yellow('⚪');
    case 'partial': return chalk.yellow('🟡');
    case 'error': return chalk.red('❌');
    default: return '❓';
  }
}

function getStatusText(status: string, mode: string): string {
  // Remove color codes for length calculation
  const cleanText = (() => {
    switch (status) {
      case 'production':
        return `Production (${mode})`;
      case 'local':
        return `Local (${mode})`;
      case 'not_configured':
        return 'Not configured';
      case 'partial':
        return 'Partially configured';
      case 'error':
        return 'Configuration error';
      default:
        return 'Unknown';
    }
  })();

  // Apply colors
  switch (status) {
    case 'production':
      return chalk.green(cleanText);
    case 'local':
      return chalk.blue(cleanText);
    case 'not_configured':
      return chalk.yellow(cleanText);
    case 'partial':
      return chalk.yellow(cleanText);
    case 'error':
      return chalk.red(cleanText);
    default:
      return chalk.gray(cleanText);
  }
} 