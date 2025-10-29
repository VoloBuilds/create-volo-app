import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import { logger } from '../utils/logger.js';
import { validateFirebaseProjectId } from '../utils/validation.js';
import { execFirebase } from '../utils/cli.js';

// Custom error for Firebase project ID conflicts
export class FirebaseProjectIdConflictError extends Error {
  constructor(projectId: string) {
    super(`Firebase project ID "${projectId}" already exists. Please choose a different one.`);
    this.name = 'FirebaseProjectIdConflictError';
  }
}

// Custom error for Firebase Terms of Service acceptance required
export class FirebaseTermsOfServiceError extends Error {
  constructor() {
    super('Google Cloud Platform Terms of Service must be accepted before creating Firebase projects.');
    this.name = 'FirebaseTermsOfServiceError';
  }
}

// Custom error for first-time Firebase setup requiring manual project creation
export class FirebaseFirstTimeSetupError extends Error {
  constructor() {
    super('First Firebase project must be created manually through Firebase Console.');
    this.name = 'FirebaseFirstTimeSetupError';
  }
}

interface FirebaseConfig {
  projectId: string;
  apiKey: string;
  messagingSenderId: string;
  appId: string;
  measurementId: string;
  allowAnonymous: boolean;
}

async function checkFirebaseAuth(): Promise<boolean> {
  try {
    const { stdout } = await execFirebase(['login:list']);
    return stdout.includes('@');
  } catch {
    return false;
  }
}

async function checkFirebaseFirstTimeSetup(): Promise<boolean> {
  try {
    // Try to list Firebase projects to check if user has created any before
    const { stdout } = await execFirebase(['projects:list', '-j']);
    const response = JSON.parse(stdout);
    
    // Check if user has any existing Firebase projects
    const projects = response.result || [];
    return projects.length === 0; // Returns true if this is first time setup
  } catch (error) {
    if (error instanceof Error) {
      // Check for specific permission errors that indicate Terms of Service issues
      if (error.message.includes('The caller does not have permission') ||
          error.message.includes('Terms of Service') ||
          error.message.includes('TOS')) {
        throw new FirebaseTermsOfServiceError();
      }
    }
    // For other errors, assume it's not first time setup
    return false;
  }
}

export async function setupFirebase(fastMode = false, projectName?: string): Promise<FirebaseConfig> {
  logger.newLine();
  console.log(chalk.yellow.bold('🔐 Setting up Firebase Authentication'));
  console.log(chalk.white('Firebase handles secure user login/signup for your app.'));
  console.log(chalk.white('This includes Google Sign-In, password reset, and user management.'));
  logger.newLine();

  // Check if user is logged into Firebase
  const isLoggedIn = await checkFirebaseAuth();
  if (!isLoggedIn) {
    logger.warning('Firebase authentication required. Please authenticate first.');
    throw new Error('Firebase authentication required');
  }

  // Check if this is the user's first Firebase project
  const isFirstTimeSetup = await checkFirebaseFirstTimeSetup();
  if (isFirstTimeSetup) {
    displayFirstTimeSetupMessage();
    throw new FirebaseFirstTimeSetupError();
  }

  let projectId: string;

  if (fastMode) {
    // In fast mode, always create a new project with project name
    projectId = await createFirebaseProjectFast(projectName || 'volo-app');
  } else {
    // Choose between creating new project or using existing
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'Would you like to create a new Firebase project or use an existing one?',
        choices: [
          { name: 'Create a new Firebase project', value: 'create' },
          { name: 'Use an existing Firebase project', value: 'existing' }
        ]
      }
    ]);

    if (action === 'create') {
      projectId = await createFirebaseProject(projectName);
    } else {
      projectId = await selectExistingProject(projectName);
    }
  }

  // Set up authentication (skip Google Sign-In in fast mode)
  if (!fastMode) {
    await setupFirebaseAuth(projectId);
  }

  // Ask about anonymous user access
  let allowAnonymous: boolean;
  if (fastMode) {
    // In fast mode, default to allowing anonymous users
    allowAnonymous = true;
  } else {
    logger.newLine();
    console.log(chalk.gray('When enabled, users can explore your app immediately without authentication.'));
    console.log(chalk.gray('They can sign in later to associate their account with a permanent login.'));
    logger.newLine();
    
    const { allowAnonymousAnswer } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'allowAnonymousAnswer',
        message: 'Allow anonymous users to access the app before signing in?',
        default: false
      }
    ]);
    allowAnonymous = allowAnonymousAnswer;
  }

  // If anonymous auth is enabled, guide user to enable it in Firebase Console
  if (allowAnonymous) {
    await setupAnonymousAuth(projectId, fastMode);
  }

  // Create and configure web app
  const webAppConfig = await createWebApp(projectId);

  logger.success('Firebase setup completed!');
  logger.newLine();

  return {
    ...webAppConfig,
    allowAnonymous
  };
}

async function createFirebaseProjectFast(baseProjectName: string): Promise<string> {
  // Sanitize project name for Firebase (lowercase, hyphens only)
  const sanitizedName = baseProjectName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/--+/g, '-').replace(/^-|-$/g, '');
  let projectId = sanitizedName;
  let displayName = baseProjectName;
  let attempt = 0;

  while (attempt < 10) { // Limit attempts to avoid infinite loop
    const spinner = ora(`Creating Firebase project "${projectId}"...`).start();

    try {
      await execFirebase(['projects:create', projectId, '--display-name', displayName]);
      spinner.succeed(`Firebase project "${projectId}" created successfully`);
      return projectId;
    } catch (error) {
      spinner.stop();
      
      // If project ID already exists, try with a number suffix
      if (error instanceof Error && (
        error.message.includes('already exists') || 
        error.message.includes('ALREADY_EXISTS') ||
        error.message.includes('project with ID')
      )) {
        attempt++;
        projectId = `${sanitizedName}-${attempt}`;
        displayName = `${baseProjectName} ${attempt}`;
        logger.debug(`Project ID "${sanitizedName}" exists, trying "${projectId}"`);
        continue;
      }
      
      // Check if this is a Terms of Service error (fallback)
      if (error instanceof Error && (
        error.message.includes('Terms of Service') ||
        error.message.includes('Callers must accept Terms of Service') ||
        error.message.includes('TOS') ||
        error.message.includes('Failed to create project. See firebase-debug.log') ||
        error.message.includes('Failed to add Firebase to Google Cloud Platform project') ||
        error.message.includes('The caller does not have permission')
      )) {
        displayTermsOfServiceMessage();
        throw new FirebaseTermsOfServiceError();
      }
      
      // Other error, fail immediately
      spinner.fail('Failed to create Firebase project');
      logger.newLine();
      console.log(chalk.red('❌ Firebase project creation failed:'));
      console.log(chalk.gray(error instanceof Error ? error.message : String(error)));
      logger.newLine();
      throw new Error(`Failed to create Firebase project: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // If we've tried 10 variations and all failed, provide better guidance
  logger.error(`Failed to find a unique Firebase project ID after trying 10 variations of "${sanitizedName}"`);
  logger.newLine();
  console.log(chalk.yellow('💡 All variations of your project name are taken. Consider:'));
  console.log(chalk.white(`   • Using a more unique project name`));
  console.log(chalk.white(`   • Adding your initials or organization name`));
  console.log(chalk.white(`   • Adding the current year or date`));
  logger.newLine();
  throw new Error('Failed to create Firebase project after multiple attempts');
}

async function createFirebaseProject(suggestedName?: string): Promise<string> {
  // Generate a default project ID suggestion
  const defaultProjectId = suggestedName 
    ? suggestedName.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/--+/g, '-').replace(/^-|-$/g, '')
    : 'my-volo-app';

  const { projectId } = await inquirer.prompt([
    {
      type: 'input',
      name: 'projectId',
      message: 'Enter a project ID for your new Firebase project:',
      default: defaultProjectId,
      validate: (input: string) => {
        if (!input.trim()) {
          return 'Project ID is required';
        }
        if (!validateFirebaseProjectId(input)) {
          return 'Project ID must be 6-30 characters, lowercase letters, numbers, and hyphens only, start with letter';
        }
        return true;
      }
    }
  ]);

  const { displayName } = await inquirer.prompt([
    {
      type: 'input',
      name: 'displayName',
      message: 'Enter a display name for your project:',
      default: projectId
    }
  ]);

  try {
    return await attemptFirebaseProjectCreation(projectId, displayName);
  } catch (error) {
    // If it's a project ID conflict, ask for a new project ID
    if (error instanceof FirebaseProjectIdConflictError) {
      return await createFirebaseProject(suggestedName);
    }
    
    // For Terms of Service errors, bubble them up to the retry logic
    if (error instanceof FirebaseTermsOfServiceError) {
      throw error;
    }
    
    // For other errors, propagate them up
    throw error;
  }
}

async function attemptFirebaseProjectCreation(projectId: string, displayName: string): Promise<string> {
  const spinner = ora(`Creating Firebase project "${projectId}"...`).start();

  try {
    await execFirebase(['projects:create', projectId, '--display-name', displayName]);
    spinner.succeed(`Firebase project "${projectId}" created successfully`);
    return projectId;
  } catch (error) {
    spinner.fail('Failed to create Firebase project');
    
    // Check if project ID already exists
    if (error instanceof Error && (
      error.message.includes('already exists') || 
      error.message.includes('ALREADY_EXISTS') ||
      error.message.includes('project with ID')
    )) {
      logger.newLine();
      logger.error(`Project ID "${projectId}" is already taken.`);
      console.log(chalk.yellow('💡 Firebase project IDs must be globally unique across all Firebase projects.'));
      console.log(chalk.white('Try adding a number or your initials to make it unique (e.g., "my-app-2024" or "my-app-jd").'));
      logger.newLine();
      
      throw new FirebaseProjectIdConflictError(projectId);
    }
    
    // Check if this is a Terms of Service error (fallback)
    if (error instanceof Error && (
      error.message.includes('Terms of Service') ||
      error.message.includes('Callers must accept Terms of Service') ||
      error.message.includes('TOS') ||
      error.message.includes('Failed to create project. See firebase-debug.log') ||
      error.message.includes('Failed to add Firebase to Google Cloud Platform project') ||
      error.message.includes('The caller does not have permission')
    )) {
      displayTermsOfServiceMessage();
      throw new FirebaseTermsOfServiceError();
    }
    
    // For other errors, show brief error information
    logger.newLine();
    console.log(chalk.red('❌ Firebase project creation failed:'));
    console.log(chalk.gray(error instanceof Error ? error.message : String(error)));
    logger.newLine();
    
    throw new Error(`Failed to create Firebase project: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function selectExistingProject(suggestedName?: string): Promise<string> {
  const spinner = ora('Fetching your Firebase projects...').start();
  
  try {
    const { stdout } = await execFirebase(['projects:list', '-j']);
    const response = JSON.parse(stdout);
    
    // Extract projects from the nested response
    const projects = response.result;
    
    spinner.stop();
    
    if (!projects || projects.length === 0) {
      logger.info('No existing Firebase projects found. Let\'s create a new one.');
      return await createFirebaseProject(suggestedName);
    }
    
    const { projectId } = await inquirer.prompt([
      {
        type: 'list',
        name: 'projectId',
        message: 'Select a Firebase project:',
        choices: projects.map((project: any) => ({
          name: `${project.displayName || project.projectId} (${project.projectId})`,
          value: project.projectId
        }))
      }
    ]);
    
    return projectId;
  } catch (error) {
    spinner.fail('Failed to fetch Firebase projects');
    throw new Error(`Failed to fetch projects: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function setupFirebaseAuth(projectId: string): Promise<void> {
  logger.info('Setting up Firebase Authentication...');
  logger.newLine();

  console.log(chalk.gray('Firebase Authentication provides secure user login for your app.'));
  console.log(chalk.gray('We recommend setting up Google Sign-In as it\'s the most popular option.'));
  logger.newLine();

  const { setupGoogleAuth } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'setupGoogleAuth',
      message: 'Would you like to set up Google Sign-In now?',
      default: true
    }
  ]);

  if (!setupGoogleAuth) {
    logger.newLine();
    logger.info('Skipping Google Sign-In setup. You can configure authentication later.');
    logger.newLine();
    console.log(chalk.blue('📚 To set up authentication later:'));
    console.log(chalk.gray('1. Go to: https://console.firebase.google.com/project/' + projectId + '/authentication/providers'));
    console.log(chalk.gray('2. Choose your preferred authentication methods'));
    console.log(chalk.gray('3. Follow the setup instructions for each provider'));
    logger.newLine();
    return;
  }

  // Provide step-by-step Google Sign-In setup
  logger.info('Setting up Google Sign-In...');
  logger.newLine();

  console.log(chalk.yellow('📋 Please follow these steps in your browser:'));
  console.log(chalk.blue('1. Open Firebase Console:'));
  console.log(chalk.cyan(`   https://console.firebase.google.com/project/${projectId}/authentication/providers`));
  logger.newLine();

  console.log(chalk.blue('2. Enable Google Sign-In:'));
  console.log(chalk.gray('   • Click on "Google" in the Sign-in providers list'));
  console.log(chalk.gray('   • Toggle the "Enable" switch'));
  console.log(chalk.gray('   • Enter a project support email (your email)'));
  console.log(chalk.gray('   • Click "Save"'));
  logger.newLine();

  console.log(chalk.blue('3. Configure authorized domains (for deployment):'));
  console.log(chalk.gray('   • Go to Authentication > Settings > Authorized domains'));
  console.log(chalk.gray('   • Add your domain when you deploy (e.g., your-app.pages.dev)'));
  console.log(chalk.gray('   • localhost is already authorized for development'));
  logger.newLine();

  console.log(chalk.yellow('⏳ Take your time to complete the setup in the browser...'));
  logger.newLine();

  const { completed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'completed',
      message: 'Have you completed the Google Sign-In setup in Firebase Console?',
      default: true // Default to 'yes' since they chose to set it up
    }
  ]);

  if (completed) {
    logger.success('Google Sign-In setup completed! 🎉');
    logger.newLine();
    console.log(chalk.green('✅ Your app now supports Google authentication'));
    console.log(chalk.gray('Users will be able to sign in with their Google accounts'));
  } else {
    logger.warning('Google Sign-In setup incomplete.');
    logger.info('Don\'t worry! You can complete this setup anytime by:');
    console.log(chalk.cyan('1. Going to: https://console.firebase.google.com/project/' + projectId + '/authentication/providers'));
    console.log(chalk.cyan('2. Following the steps outlined above'));
    logger.newLine();
    console.log(chalk.yellow('💡 Your app will work for development, but users won\'t be able to sign in until you complete this setup.'));
  }

  logger.newLine();
}

async function setupAnonymousAuth(projectId: string, fastMode: boolean): Promise<void> {
  logger.newLine();
  logger.info('Setting up Anonymous Authentication...');
  logger.newLine();

  console.log(chalk.gray('Anonymous authentication allows users to access your app immediately'));
  console.log(chalk.gray('without signing up. They can convert to a permanent account later.'));
  logger.newLine();

  console.log(chalk.yellow('📋 Please enable Anonymous Authentication in Firebase Console:'));
  logger.newLine();

  console.log(chalk.blue('1. Open Firebase Console:'));
  console.log(chalk.cyan(`   https://console.firebase.google.com/project/${projectId}/authentication/providers`));
  logger.newLine();

  console.log(chalk.blue('2. Enable Anonymous Sign-In:'));
  console.log(chalk.gray('   • Scroll down and click on "Anonymous" in the providers list'));
  console.log(chalk.gray('   • Toggle the "Enable" switch to ON'));
  console.log(chalk.gray('   • Click "Save"'));
  logger.newLine();

  if (fastMode) {
    // In fast mode, just show instructions without prompting
    console.log(chalk.green('✅ Your app is configured to allow anonymous users'));
    console.log(chalk.yellow('⚠️  Remember to enable Anonymous authentication in Firebase Console'));
    console.log(chalk.gray('   Users won\'t be able to access the app until this is enabled'));
  } else {
    // In interactive mode, wait for confirmation
    console.log(chalk.yellow('⏳ This takes just a few seconds...'));
    logger.newLine();

    const { completed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'completed',
        message: 'Have you enabled Anonymous authentication in Firebase Console?',
        default: true
      }
    ]);

    if (completed) {
      logger.success('Anonymous authentication enabled! 🎉');
      logger.newLine();
      console.log(chalk.green('✅ Users can now access your app without signing in'));
      console.log(chalk.gray('They can upgrade to a permanent account anytime'));
    } else {
      logger.warning('Anonymous authentication not enabled.');
      logger.newLine();
      console.log(chalk.yellow('⚠️  Your app is configured to allow anonymous users, but Firebase will reject them'));
      console.log(chalk.yellow('   until you enable this setting in the Firebase Console.'));
      logger.newLine();
      console.log(chalk.blue('To enable it later:'));
      console.log(chalk.cyan(`1. Go to: https://console.firebase.google.com/project/${projectId}/authentication/providers`));
      console.log(chalk.cyan('2. Enable the "Anonymous" sign-in method'));
    }
  }

  logger.newLine();
}

async function createWebApp(projectId: string): Promise<Omit<FirebaseConfig, 'allowAnonymous'>> {
  // First, check if there are existing web apps
  const existingApps = await getExistingWebApps(projectId);
  
  let appId: string;
  
  if (existingApps.length > 0) {
    logger.info(`Found ${existingApps.length} existing web app(s) in this project.`);
    
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'Would you like to use an existing web app or create a new one?',
        choices: [
          { name: 'Use an existing web app', value: 'existing' },
          { name: 'Create a new web app', value: 'create' }
        ]
      }
    ]);
    
    if (action === 'existing') {
      const { selectedAppId } = await inquirer.prompt([
        {
          type: 'list',
          name: 'selectedAppId',
          message: 'Select a web app:',
          choices: existingApps.map((app: any) => ({
            name: `${app.displayName || 'Unnamed App'} (${app.appId})`,
            value: app.appId
          }))
        }
      ]);
      appId = selectedAppId;
    } else {
      appId = await createNewWebApp(projectId);
    }
  } else {
    logger.info('No existing web apps found. Creating a new one...');
    appId = await createNewWebApp(projectId);
  }
  
  // Get app configuration
  return getWebAppConfig(projectId, appId);
}

async function getExistingWebApps(projectId: string): Promise<any[]> {
  try {
    const { stdout } = await execFirebase(['apps:list', 'WEB', '--project', projectId, '-j']);
    const response = JSON.parse(stdout);
    return response.result || [];
  } catch (error) {
    logger.debug(`Failed to fetch existing apps: ${error}`);
    return [];
  }
}

async function createNewWebApp(projectId: string): Promise<string> {
  const spinner = ora('Creating Firebase web app...').start();
  
  try {
    // Create web app (remove --json flag as it doesn't work)
    const { stdout } = await execFirebase([
      'apps:create', 
      'WEB', 
      'volo-app',
      '--project', projectId
    ]);
    
    // Try multiple patterns for different CLI versions
    const patterns = [
      /- App ID: (.+)/,
      /App ID:\s*(.+)/,
      /appId[:\s]+(.+)/i,
      /App\s+ID[:\s]+(.+)/i
    ];

    let appId: string | null = null;
    for (const pattern of patterns) {
      const match = stdout.match(pattern);
      if (match) {
        appId = match[1].trim();
        break;
      }
    }

    if (!appId) {
      logger.debug(`Firebase CLI output: ${stdout}`);
      throw new Error('Failed to extract App ID. Please check Firebase CLI output format.');
    }
    
    logger.debug(`Extracted App ID: ${appId}`);
    spinner.succeed('Firebase web app created successfully');
    
    return appId;
  } catch (error) {
    spinner.fail('Failed to create Firebase web app');
    throw error;
  }
}

async function getWebAppConfig(projectId: string, appId: string): Promise<Omit<FirebaseConfig, 'allowAnonymous'>> {
  const spinner = ora('Getting web app configuration...').start();
  
  try {
    // Get app configuration
    const { stdout: configOutput } = await execFirebase([
      'apps:sdkconfig', 
      'WEB', 
      appId,
      '--project', projectId,
      '--json'
    ]);
    
    const config = JSON.parse(configOutput);
    
    // Extract the SDK config from the nested response
    const sdkConfig = config.result?.sdkConfig;
    if (!sdkConfig) {
      throw new Error('Invalid response format from Firebase CLI');
    }
    
    spinner.succeed('Firebase web app configured');
    
    return {
      projectId: sdkConfig.projectId,
      apiKey: sdkConfig.apiKey,
      messagingSenderId: sdkConfig.messagingSenderId,
      appId: sdkConfig.appId,
      measurementId: sdkConfig.measurementId || 'G-PLACEHOLDER'
    };
    
  } catch (error) {
    spinner.fail('Failed to get web app configuration');
    throw new Error(`Failed to get web app config: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Helper functions for displaying error messages
function displayFirstTimeSetupMessage(): void {
  logger.newLine();
  logger.error('First Firebase project must be created manually.');
  console.log(chalk.yellow('🔥 Google requires your first Firebase project to be created manually.'));
  console.log(chalk.white('This is a one-time requirement - after this first project, you can create'));
  console.log(chalk.white('additional projects programmatically through volo-app.'));
  logger.newLine();
  console.log(chalk.blue.bold('📋 Quick setup (takes 2 minutes):'));
  console.log(chalk.white('1. Open Firebase Console: https://console.firebase.google.com'));
  console.log(chalk.white('2. Click "Create a project" or "Add project"'));
  console.log(chalk.white('3. Follow the setup wizard (accept defaults)'));
  console.log(chalk.white('4. Once created, run your volo-app create command again'));
  logger.newLine();
  console.log(chalk.gray('💡 After this one-time setup, volo-app will handle everything automatically.'));
  logger.newLine();
}

function displayTermsOfServiceMessage(): void {
  logger.newLine();
  logger.error('Google Cloud Platform Terms of Service must be accepted first.');
  console.log(chalk.yellow('🔗 You need to accept Google Cloud\'s Terms of Service before creating Firebase projects.'));
  logger.newLine();
  console.log(chalk.blue.bold('📋 Quick fix:'));
  console.log(chalk.white('1. Open Google Cloud Console: https://console.cloud.google.com'));
  console.log(chalk.white('2. Sign in with the same Google account'));
  console.log(chalk.white('3. Accept the Terms of Service when prompted'));
  console.log(chalk.white('4. Wait 2-3 minutes, then retry'));
  logger.newLine();
  console.log(chalk.gray('💡 This is a one-time setup required for Google Cloud services.'));
  logger.newLine();
} 