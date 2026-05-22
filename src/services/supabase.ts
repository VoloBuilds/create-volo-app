import inquirer from 'inquirer';
import chalk from 'chalk';
import { execa } from 'execa';
import ora from 'ora';
import { logger } from '../utils/logger.js';
import { execSupabase } from '../utils/cli.js';
import type { VoloConfig } from '../utils/config.js';

interface DatabaseConfig {
  url: string;
  provider: 'supabase';
}

interface SupabaseProject {
  id: string;
  name: string;
  organization_id: string;
  region: string;
  created_at: string;
}

interface ProjectWithPassword extends SupabaseProject {
  dbPassword?: string;
}

// === CLI HELPERS ===

async function checkSupabaseCLI(): Promise<boolean> {
  try {
    await execSupabase(['--version'], { stdio: 'pipe' });
    return true;
  } catch (error) {
    return false;
  }
}

async function isSupabaseAuthenticated(): Promise<boolean> {
  try {
    // Check if already authenticated by trying to list projects
    const { stdout } = await execSupabase(['projects', 'list'], { stdio: 'pipe' });
    return stdout.includes('ID') || stdout.includes('Name'); // Basic check for project list output
  } catch (error) {
    return false;
  }
}

async function listSupabaseProjects(): Promise<SupabaseProject[]> {
  try {
    const { stdout } = await execSupabase(['projects', 'list', '--output', 'json'], { stdio: 'pipe' });
    const projects = JSON.parse(stdout);
    return Array.isArray(projects) ? projects : [];
  } catch (error) {
    logger.debug(`Failed to list Supabase projects: ${error}`);
    return [];
  }
}

async function getDefaultOrgId(): Promise<string | null> {
  try {
    // Try to get organization ID from existing projects first
    const projects = await listSupabaseProjects();
    if (projects.length > 0) {
      return projects[0].organization_id;
    }
    
    // If no projects, try to list organizations
    const { stdout } = await execSupabase(['orgs', 'list', '--output', 'json'], { stdio: 'pipe' });
    const orgs = JSON.parse(stdout);
    if (Array.isArray(orgs) && orgs.length > 0) {
      return orgs[0].id;
    }
    
    return null;
  } catch (error) {
    logger.debug(`Failed to get organization ID: ${error}`);
    return null;
  }
}

// === PROJECT MANAGEMENT ===

function generateSecurePassword(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
  return Array.from({ length: 16 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

async function createSupabaseProject(baseName: string): Promise<ProjectWithPassword | null> {
  const orgId = await getDefaultOrgId();
  if (!orgId) {
    logger.warning('Could not determine organization ID for project creation');
    return null;
  }

  const dbPassword = generateSecurePassword();
  let projectName = baseName;
  let attempt = 0;

  while (attempt < 10) {
    const spinner = ora(`Creating new Supabase project "${projectName}"...`).start();
    
    try {
      const args = [
        'projects', 'create', projectName,
        '--org-id', orgId,
        '--db-password', dbPassword,
        '--region', 'us-east-1',
        '--output', 'json'
      ];
      
      logger.debug(`Executing: supabase projects create ${projectName} --org-id ${orgId} --db-password [REDACTED] --region us-east-1 --output json`);
      const { stdout } = await execSupabase(args, { stdio: 'pipe' });
      
      const project = JSON.parse(stdout) as SupabaseProject;
      spinner.succeed(`Project "${projectName}" created successfully!`);
      
      return { ...project, dbPassword };
    } catch (error) {
      spinner.stop();
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.debug(`Project creation failed: ${errorMessage}`);
      
      // Check if it's a name conflict error
      if (errorMessage.includes('already exists') || errorMessage.includes('name is taken') || errorMessage.includes('duplicate')) {
        attempt++;
        projectName = `${baseName}-${attempt}`;
        logger.debug(`Project name "${baseName}" exists, trying "${projectName}"`);
        continue;
      }
      
      // Other error, fail immediately
      spinner.fail('Failed to create project');
      console.log(chalk.red('Error details:'), errorMessage);
      return null;
    }
  }
  
  logger.warning('Failed to create project after multiple attempts');
  return null;
}

async function getProjectDetails(projectId: string): Promise<SupabaseProject | null> {
  try {
    const { stdout } = await execSupabase(['projects', 'get', projectId, '--output', 'json'], { stdio: 'pipe' });
    return JSON.parse(stdout);
  } catch (error) {
    logger.debug(`Failed to get project details: ${error}`);
    return null;
  }
}

// === CONNECTION STRING HELPERS ===

function getProjectRegion(project: SupabaseProject): string {
  const regionMap: Record<string, string> = {
    'us-east-1': 'us-east-1',
    'us-west-1': 'us-west-1',
    'eu-west-1': 'eu-west-1',
    'ap-southeast-1': 'ap-southeast-1',
    'ap-northeast-1': 'ap-northeast-1',
  };
  
  return regionMap[project.region] || 'us-east-1';
}

function createConnectionString(projectRef: string, password: string, region = 'us-east-1'): string {
  const encodedPassword = encodeURIComponent(password);
  return `postgresql://postgres.${projectRef}:${encodedPassword}@aws-0-${region}.pooler.supabase.com:5432/postgres`;
}

async function promptForPassword(projectRef: string, fastMode = false): Promise<string> {
  if (fastMode) {
    console.log(chalk.blue('🔑 One Quick Step: Database Password'));
    console.log(chalk.white('We need your Supabase database password to complete the setup.'));
    console.log(chalk.gray('This is the only manual step required in fast mode.'));
  } else {
    console.log(chalk.blue('🔑 Database Password Required'));
    console.log(chalk.white('Supabase requires your database password to create the connection string.'));
    console.log(chalk.gray('You can find this in your Supabase dashboard under Settings > Database.'));
    console.log(chalk.yellow('💡 We\'ll generate an IPv4 pooled connection for better platform compatibility.'));
  }
  logger.newLine();

  const { openDashboard } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'openDashboard',
      message: 'Would you like me to open the Supabase dashboard to get your password?',
      default: true
    }
  ]);

  if (openDashboard) {
    const spinner = ora('Opening Supabase dashboard...').start();
    try {
      const url = `https://supabase.com/dashboard/project/${projectRef}/settings/database`;
      const command = process.platform === 'win32' ? 'start' : 
                    process.platform === 'darwin' ? 'open' : 'xdg-open';
      
      await execa(command, [url], { stdio: 'ignore' });
      spinner.succeed('Supabase dashboard opened in browser');
      console.log(chalk.gray('Look for the "Database password" field in the Connection info section.'));
    } catch (error) {
      spinner.fail('Failed to open browser');
      console.log(chalk.yellow('Please manually open: ') + chalk.cyan(`https://supabase.com/dashboard/project/${projectRef}/settings/database`));
      console.log(chalk.gray('Look for the "Database password" field in the Connection info section.'));
    }
  }

  const { password } = await inquirer.prompt([
    {
      type: 'password',
      name: 'password',
      message: 'Enter your Supabase database password:',
      validate: (input: string) => {
        if (!input.trim()) {
          return 'Database password is required';
        }
        return true;
      }
    }
  ]);

  return password;
}

// === PROJECT SELECTION ===

async function selectOrCreateProject(
  fastMode: boolean,
  projectName?: string,
  configAction?: 'create' | 'existing',
  configProjectName?: string
): Promise<{ project: SupabaseProject; password: string } | null> {
  const projects = await listSupabaseProjects();
  const defaultProjectName = configProjectName || `${projectName || 'volo-app'}-db`;

  const shouldCreate = configAction === 'create' || fastMode || projects.length === 0;
  const shouldSelectExisting = configAction === 'existing' && projects.length > 0;

  if (shouldCreate && !shouldSelectExisting) {
    if (projects.length === 0) {
      console.log(chalk.yellow('No existing Supabase projects found.'));
    } else if (configAction === 'create') {
      console.log(chalk.blue('Creating new Supabase project (from config)...'));
    } else if (fastMode) {
      console.log(chalk.blue('Creating new Supabase project (fast mode)...'));
    }
    logger.newLine();

    const newProject = await createSupabaseProject(defaultProjectName);
    if (!newProject) {
      return null;
    }

    return {
      project: newProject,
      password: newProject.dbPassword!
    };
  }

  // Interactive mode with existing projects
  console.log(chalk.green(`Found ${projects.length} existing Supabase project(s)`));
  logger.newLine();

  const projectChoices = [
    ...projects.map(project => ({
      name: `${project.name} (${project.id})`,
      value: project.id,
      short: project.name
    })),
    {
      name: '+ Create a new project',
      value: 'new',
      short: 'New project'
    }
  ];

  const { selectedProject } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selectedProject',
      message: 'Which Supabase project would you like to use?',
      choices: projectChoices
    }
  ]);

  if (selectedProject === 'new') {
    const { newProjectName } = await inquirer.prompt([
      {
        type: 'input',
        name: 'newProjectName',
        message: 'Enter a name for your new Supabase project:',
        default: defaultProjectName,
        validate: (input: string) => {
          if (!input.trim()) return 'Project name is required';
          if (input.length > 50) return 'Project name must be 50 characters or less';
          return true;
        }
      }
    ]);

    const newProject = await createSupabaseProject(newProjectName);
    if (!newProject) {
      return null;
    }

    return {
      project: newProject,
      password: newProject.dbPassword!
    };
  }

  // Use existing project
  const project = projects.find(p => p.id === selectedProject);
  if (!project) {
    logger.warning('Selected project not found');
    return null;
  }

  const password = await promptForPassword(selectedProject, false);
  return { project, password };
}

// === MAIN SETUP FUNCTIONS ===

export async function setupSupabaseDatabase(fastMode = false, projectName?: string, configData?: VoloConfig): Promise<DatabaseConfig> {
  logger.info('Setting up Supabase database...');
  logger.newLine();

  // If config provides a connection string directly, use it (no prompt or CLI required)
  const configuredConnString = configData?.database?.connectionString;
  if (configuredConnString) {
    logger.info('Using Supabase connection string from config');
    logger.success('Supabase database configured!');
    logger.newLine();
    return {
      url: configuredConnString,
      provider: 'supabase'
    };
  }

  // Check prerequisites
  const hasSupabaseCLI = await checkSupabaseCLI();
  if (!hasSupabaseCLI) {
    logger.warning('Supabase CLI not found. Using manual setup instead.');
    return await setupSupabaseDatabaseManual();
  }

  const isAuthenticated = await isSupabaseAuthenticated();
  if (!isAuthenticated) {
    logger.warning('Supabase authentication failed. Using manual setup instead.');
    return await setupSupabaseDatabaseManual();
  }

  // Get or create project
  const spinner = ora('Loading your Supabase projects...').start();
  spinner.stop();

  const dbConfig = configData?.database;
  const result = await selectOrCreateProject(fastMode, projectName, dbConfig?.action, dbConfig?.projectName);
  if (!result) {
    logger.warning('Failed to set up project. Using manual setup instead.');
    return await setupSupabaseDatabaseManual();
  }

  const { project, password } = result;
  const region = getProjectRegion(project);
  const connectionString = createConnectionString(project.id, password, region);

  logger.success('Supabase database configured!');
  logger.newLine();

  return {
    url: connectionString,
    provider: 'supabase'
  };
}

async function setupSupabaseDatabaseManual(): Promise<DatabaseConfig> {
  console.log(chalk.yellow('📋 Manual setup required:'));
  console.log(chalk.gray('1. Go to: https://supabase.com/dashboard'));
  console.log(chalk.gray('2. Sign up for a free account (if you don\'t have one)'));
  console.log(chalk.gray('3. Create a new project'));
  console.log(chalk.gray('4. Go to Settings > Database'));
  console.log(chalk.gray('5. Copy the POOLED connection string (IPv4) - NOT the direct connection'));
  console.log(chalk.gray('   Look for: Session pooler > Connection string'));
  console.log(chalk.gray('   Format: postgresql://postgres.PROJECT_REF:[password]@aws-0-[region].pooler.supabase.com:5432/postgres'));
  logger.newLine();

  console.log(chalk.blue('💡 Important: Use the pooled connection for better compatibility!'));
  console.log(chalk.gray('   The pooled connection works on IPv4-only platforms like Vercel, GitHub Actions, etc.'));
  logger.newLine();

  const { hasAccount } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'hasAccount',
      message: 'Do you already have a Supabase account?',
      default: false
    }
  ]);

  if (!hasAccount) {
    console.log(chalk.blue('👉 Opening Supabase signup page...'));
    console.log(chalk.gray('Please create an account and return here when you have your pooled connection string.'));
    logger.newLine();
    
    console.log(chalk.blue('Sign up at: https://supabase.com/dashboard'));
    logger.newLine();
  }

  const { connectionString } = await inquirer.prompt([
    {
      type: 'input',
      name: 'connectionString',
      message: 'Enter your Supabase POOLED connection string:',
      validate: (input: string) => {
        if (!input.trim()) {
          return 'Connection string is required';
        }
        if (!input.startsWith('postgresql://')) {
          return 'Connection string should start with "postgresql://"';
        }
        if (input.includes('db.') && input.includes('.supabase.co:5432')) {
          return 'Please use the POOLED connection string (aws-0-region.pooler.supabase.com), not the direct connection (db.project.supabase.co)';
        }
        return true;
      }
    }
  ]);

  logger.success('Supabase database configured!');
  logger.newLine();

  return {
    url: connectionString,
    provider: 'supabase'
  };
} 