import chalk from 'chalk';
import { existsSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import inquirer from 'inquirer';
import { setupDatabaseWithRetry } from '../shared/serviceSetup.js';
import { 
  getProjectNameAndSlugFromPackageJson,
  sanitizeConnectionString
} from './shared.js';
import { logger } from '../../utils/logger.js';
import { execPnpm } from '../../utils/cli.js';

/**
 * Confirm reconfiguration for existing database connection
 */
async function confirmReconfiguration(): Promise<boolean> {
  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Would you like to reconfigure to a different database?',
      default: false
    }
  ]);
  return confirm;
}

/**
 * Confirm proceeding with production database setup
 */
async function confirmProductionSetup(): Promise<boolean> {
  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Proceed with database production setup?',
      default: true
    }
  ]);
  return confirm;
}

export async function connectDatabase(projectPath: string, provider?: string): Promise<void> {
  try {
    console.log(chalk.cyan.bold('🗄️  Database Production Connection'));
    console.log('This will connect your volo-app to a production database.\n');
    
    // Check current database configuration
    const currentConfig = await detectCurrentDatabaseConfig(projectPath);
    
    if (currentConfig.isProduction) {
      console.log(chalk.green('✅ Already connected to a production database'));
      console.log(chalk.gray(`   Provider: ${currentConfig.provider}`));
      if (currentConfig.connectionString) {
        console.log(chalk.gray(`   Connection: ${sanitizeConnectionString(currentConfig.connectionString)}`));
      }
      
      if (!(await confirmReconfiguration())) {
        console.log(chalk.blue('👋 No changes made'));
        return;
      }
    } else if (currentConfig.isLocal) {
      console.log(chalk.blue('🏠 Currently using local embedded PostgreSQL server'));
      await checkLocalDatabaseData(projectPath);
    } else {
      console.log(chalk.yellow('⚠️  No database configuration found'));
    }
    
    // Confirm before proceeding
    if (!(await confirmProductionSetup())) {
      console.log(chalk.blue('👋 Operation cancelled'));
      return;
    }
    
    // Backup current configuration
    await backupDatabaseConfig(projectPath);
    
    // Determine provider
    let selectedProvider = provider;
    if (!selectedProvider) {
      selectedProvider = await promptDatabaseProvider();
    }
    
    // Get service slug from package.json for cloud resource naming
    const { serviceSlug } = await getProjectNameAndSlugFromPackageJson(projectPath);
    
    console.log(chalk.blue(`\n🔐 Setting up ${selectedProvider} database...`));
    
    let databaseResult;
    switch (selectedProvider) {
      case 'neon':
        databaseResult = await setupDatabaseWithRetry('neon', 2, false, serviceSlug);
        break;
      case 'supabase':
        databaseResult = await setupDatabaseWithRetry('supabase', 2, false, serviceSlug);
        break;
      case 'custom':
        databaseResult = await promptCustomDatabase();
        break;
      default:
        throw new Error(`Unknown database provider: ${selectedProvider}`);
    }
    
    if (!databaseResult.url) {
      throw new Error('Database setup failed - no connection URL provided');
    }
    
    // Update configuration files
    await updateDatabaseConfig(projectPath, databaseResult.url);
    
    console.log(chalk.green('\n🎉 Successfully connected to production database!'));
    
    // Ask if user wants to set up database schema
    const setupSchema = await promptDatabaseSetup();
    
    if (setupSchema) {
      console.log(chalk.blue('\n🔧 Setting up database schema...'));
      
      try {
        await execPnpm(['post-setup'], { 
          cwd: projectPath, 
          stdio: 'inherit' 
        });
        
        console.log(chalk.green('\n✅ Database schema created successfully!'));
        console.log(chalk.yellow('💡 Schema is ready, but you\'ll need to migrate your data when ready.'));
      } catch (error) {
        console.log(chalk.yellow('\n⚠️ Schema setup encountered issues'));
        console.log(chalk.gray('   You can run it manually later with: pnpm post-setup'));
      }
    }
    
    console.log(chalk.cyan('\n📋 Next steps:'));
    console.log('   1. Restart your development server: pnpm dev');
    console.log('   2. Test database connectivity with your application');
    if (!setupSchema) {
      console.log('   3. Set up database schema: pnpm post-setup');
      console.log('   4. Monitor your database usage in your provider dashboard');
    } else {
      console.log('   3. Monitor your database usage in your provider dashboard');
    }
    console.log(chalk.blue('\n💡 To revert to local development:'));
    console.log('   - Restore backup: cp server/.env.backup server/.env');
    console.log('   - Restart development server to use local embedded PostgreSQL');
    
  } catch (error) {
    console.error(chalk.red(`\n❌ Error: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
  }
}

async function detectCurrentDatabaseConfig(projectPath: string) {
  const envPath = path.join(projectPath, 'server', '.env');
  
  if (!existsSync(envPath)) {
    return { isProduction: false, isLocal: false, provider: null, connectionString: null };
  }
  
  try {
    const envContent = await readFile(envPath, 'utf-8');
    const dbUrlMatch = envContent.match(/DATABASE_URL=(.+)/);
    
    if (!dbUrlMatch) {
      return { isProduction: false, isLocal: false, provider: null, connectionString: null };
    }
    
    const connectionString = dbUrlMatch[1].trim();
    const isLocal = (connectionString.includes('localhost') || connectionString.includes('127.0.0.1')) && 
                   connectionString.includes('postgres:password');
    
    let provider = 'custom';
    if (connectionString.includes('neon.tech')) {
      provider = 'neon';
    } else if (connectionString.includes('supabase.')) {
      provider = 'supabase';
    } else if (isLocal) {
      provider = 'local';
    }
    
    return {
      isProduction: !isLocal,
      isLocal,
      provider,
      connectionString
    };
  } catch (error) {
    return { isProduction: false, isLocal: false, provider: null, connectionString: null };
  }
}

async function checkLocalDatabaseData(projectPath: string) {
  console.log(chalk.gray('📋 Local database data migration is not yet implemented'));
  console.log(chalk.gray('   You may need to manually export/import data if needed'));
  logger.newLine();
}

async function backupDatabaseConfig(projectPath: string) {
  const envPath = path.join(projectPath, 'server', '.env');
  const backupPath = path.join(projectPath, 'server', '.env.backup');
  
  if (existsSync(envPath)) {
    const config = await readFile(envPath, 'utf-8');
    await writeFile(backupPath, config);
    logger.newLine();
    console.log(chalk.green('✅ Current configuration backed up to server/.env.backup'));
    logger.newLine();
  }
}

async function promptDatabaseProvider(): Promise<string> {
  const { selectedProvider } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedProvider',
      message: 'Which database provider would you like to connect to?',
      choices: [
        { 
          name: 'Neon (Recommended - PostgreSQL with serverless scaling)', 
          value: 'neon',
          short: 'Neon'
        },
        { 
          name: 'Supabase (PostgreSQL with additional features)', 
          value: 'supabase',
          short: 'Supabase'
        },
        { 
          name: 'Custom PostgreSQL (Any other PostgreSQL provider)', 
          value: 'custom',
          short: 'Custom'
        }
      ]
    }
  ]);
  
  return selectedProvider;
}

async function promptCustomDatabase() {
  console.log(chalk.cyan('\n🔧 Custom PostgreSQL Configuration'));
  console.log('Enter your PostgreSQL connection details:\n');
  
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'host',
      message: 'Database host:',
      validate: (input) => input.trim().length > 0 || 'Host is required'
    },
    {
      type: 'input',
      name: 'port',
      message: 'Database port:',
      default: '5432',
      validate: (input) => {
        const port = parseInt(input);
        return (port > 0 && port <= 65535) || 'Port must be between 1 and 65535';
      }
    },
    {
      type: 'input',
      name: 'database',
      message: 'Database name:',
      validate: (input) => input.trim().length > 0 || 'Database name is required'
    },
    {
      type: 'input',
      name: 'username',
      message: 'Username:',
      validate: (input) => input.trim().length > 0 || 'Username is required'
    },
    {
      type: 'password',
      name: 'password',
      message: 'Password:',
      mask: '*',
      validate: (input) => input.length > 0 || 'Password is required'
    }
  ]);
  
  const connectionString = `postgresql://${answers.username}:${answers.password}@${answers.host}:${answers.port}/${answers.database}`;
  
  return {
    url: connectionString,
    provider: 'other' as 'neon' | 'supabase' | 'other'
  };
}

async function updateDatabaseConfig(projectPath: string, connectionString: string) {
  const envPath = path.join(projectPath, 'server', '.env');
  let envContent = '';
  
  if (existsSync(envPath)) {
    envContent = await readFile(envPath, 'utf-8');
  }
  
  // Update or add DATABASE_URL
  const dbUrlPattern = /DATABASE_URL=.*/g;
  if (dbUrlPattern.test(envContent)) {
    envContent = envContent.replace(dbUrlPattern, `DATABASE_URL=${connectionString}`);
  } else {
    envContent += `\n# Production Database\nDATABASE_URL=${connectionString}\n`;
  }
  
  await writeFile(envPath, envContent.trim() + '\n');
  console.log(chalk.green('✅ Database configuration updated'));
}

async function promptDatabaseSetup(): Promise<boolean> {
  const { setupSchema } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'setupSchema',
      message: 'Would you like to set up the database schema?',
      default: true
    }
  ]);
  return setupSchema;
}