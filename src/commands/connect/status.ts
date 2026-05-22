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
  
  // Show connection commands
  console.log(chalk.cyan('🔧 Available Connection Commands:'));

  if (firebaseStatus.status === 'local') {
    console.log(`   ${chalk.yellow('pnpm connect:auth')}              - Connect to production Firebase Auth`);
  } else {
    console.log(`   ${chalk.green('pnpm connect:auth')}              - Reconfigure Firebase Auth (currently production)`);
  }

  if (databaseStatus.status === 'local') {
    console.log(`   ${chalk.yellow('pnpm connect:database')}          - Connect to production database`);
    console.log(`   ${chalk.yellow('pnpm connect:database:neon')}     - Connect to Neon specifically`);
    console.log(`   ${chalk.yellow('pnpm connect:database:supabase')} - Connect to Supabase specifically`);
  } else {
    console.log(`   ${chalk.green('pnpm connect:database')}          - Reconfigure database (currently production)`);
  }

  if (deploymentStatus.status === 'local') {
    console.log(`   ${chalk.yellow('pnpm connect:deploy')}            - Set up production deployment`);
  } else {
    console.log(`   ${chalk.green('pnpm connect:deploy')}            - Reconfigure deployment (currently production)`);
  }

  console.log(`   ${chalk.blue('pnpm connection:status')}          - Show this status (current command)`);
  
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
  const wranglerPath = path.join(projectPath, 'server', 'wrangler.toml');
  
  if (!existsSync(wranglerPath)) {
    return { status: 'not_configured', mode: 'local' };
  }
  
  try {
    const wranglerContent = await readFile(wranglerPath, 'utf-8');
    const nameMatch = wranglerContent.match(/name\s*=\s*["']([^"']+)["']/);
    const accountMatch = wranglerContent.match(/account_id\s*=\s*["']([^"']+)["']/);
    
    if (nameMatch && accountMatch) {
      return {
        status: 'production',
        mode: 'cloudflare',
        workerName: nameMatch[1],
        accountId: accountMatch[1]
      };
    } else {
      return { status: 'partial', mode: 'incomplete' };
    }
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