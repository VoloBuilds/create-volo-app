import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { logger } from '../utils/logger.js';
import { downloadTemplate, parseTemplateArg, copyLocalTemplate } from '../utils/template.js';
import { setupCloudflare } from '../services/cloudflare.js';
import { generateModularConfigFiles } from '../utils/modularConfig.js';
import { execPnpm, execPnpmDetached } from '../utils/cli.js';
import { CreateOptions, ProjectConfig } from './shared/types.js';
import { getProjectName, validateAndPrepareDirectory } from './shared/project.js';
import { sanitizeWorkerName } from '../utils/validation.js';
import { askToStartDevelopmentServer } from './shared/prompts.js';
import { checkAuthenticationStatus, handleBatchAuthentication } from './shared/authentication.js';
import { setupFirebaseWithRetry, setupDatabaseWithRetry } from './shared/serviceSetup.js';

export async function createApp(
  projectName: string | undefined, 
  options: CreateOptions
): Promise<void> {
  // Determine connection flags from new CLI interface
  const connectionFlags = {
    auth: !!(options.auth || options.full),
    database: !!(options.database || options.full),
    deploy: !!(options.deploy || options.full)
  };

  const configData = options.configData;

  // Get project name and directory
  const { name, serviceSlug, directory: resolvedDir, isCurrentDirectory } = await getProjectName(projectName, configData);
  const directory = await validateAndPrepareDirectory(resolvedDir, isCurrentDirectory, configData);

  // Determine setup type for messaging
  const isFullProduction = connectionFlags.auth && connectionFlags.database && connectionFlags.deploy;
  const isFullLocal = !connectionFlags.auth && !connectionFlags.database && !connectionFlags.deploy;
  const isHybrid = !isFullProduction && !isFullLocal;

  // Setup type messaging
  logger.step(`Creating project "${name}" with ${isFullLocal ? 'local development' : isFullProduction ? 'full production' : 'modular'} setup...`);
  logger.newLine();
  
  if (isFullLocal) {
    console.log(chalk.green.bold('🏠 Local Development Mode'));
    console.log('Your volo-app will be configured with:');
    console.log(chalk.white('  • Database: Local (embedded PostgreSQL)'));
    console.log(chalk.white('  • Firebase Auth: Local (emulator)'));
    console.log(chalk.white('  • Deployment: Local development only'));
    logger.newLine();
    console.log(chalk.gray('💡 Use --full flag for production setup with external services'));
  } else if (isFullProduction) {
    console.log(chalk.blue.bold('🌍 Full Production Setup'));
    console.log('Your volo-app will be configured with:');
    console.log(chalk.white('  • Database: Production (will configure)'));
    console.log(chalk.white('  • Firebase Auth: Production (will configure)'));
    console.log(chalk.white('  • Deployment: Production (Cloudflare)'));
  } else {
    console.log(chalk.cyan.bold('🔧 Modular Setup Configuration'));
    console.log('Your volo-app will be configured with:');
    console.log(chalk.white(`  • Database: ${connectionFlags.database ? 'Production (will configure)' : 'Local (embedded PostgreSQL)'}`));
    console.log(chalk.white(`  • Firebase Auth: ${connectionFlags.auth ? 'Production (will configure)' : 'Local (emulator)'}`));
    console.log(chalk.white(`  • Deployment: ${connectionFlags.deploy ? 'Production (Cloudflare)' : 'Local development only'}`));
  }
  
  logger.newLine();

  // Step 1: Download/copy template
  const templateSource = parseTemplateArg(options.template);

  const cloneSpinner = ora({
    text: templateSource.type === 'local' ? 'Copying local template...' : 'Downloading template...',
    spinner: 'line'
  }).start();

  try {
    if (templateSource.type === 'local') {
      logger.info(`Using local template: ${templateSource.localPath}`);
      await copyLocalTemplate(templateSource.localPath!, directory);
    } else {
      logger.info(`Using template: ${templateSource.url}`);
      await downloadTemplate(templateSource.url!, directory, templateSource.branch || 'main');
    }
    cloneSpinner.succeed(templateSource.type === 'local' ? 'Local template copied successfully' : 'Template downloaded successfully');
  } catch (error) {
    cloneSpinner.fail(templateSource.type === 'local' ? 'Failed to copy local template' : 'Failed to download template');
    throw error;
  }

  // Step 2: Install dependencies
  const installSpinner = ora({
    text: 'Installing dependencies...',
    spinner: 'line'
  }).start();
  
  try {
    await execPnpm(['install'], { 
      cwd: directory, 
      stdio: options.verbose ? 'inherit' : 'pipe' 
    });
    installSpinner.succeed('Dependencies installed successfully');
  } catch (error) {
    installSpinner.fail('Failed to install dependencies');
    throw error;
  }

  // Step 3: Handle authentication for production services only
  const needsAuthentication = connectionFlags.auth || connectionFlags.database || connectionFlags.deploy;
  
  if (needsAuthentication) {
    logger.newLine();
    
    // Determine which services need authentication
    const servicesToAuthenticate = [];
    if (connectionFlags.database) {
      const databaseProvider = getDatabaseProvider(options);
      if (databaseProvider) servicesToAuthenticate.push(databaseProvider);
    }
    if (connectionFlags.auth) servicesToAuthenticate.push('firebase');
    if (connectionFlags.deploy) {
      const deployProvider = getDeployProvider(options);
      servicesToAuthenticate.push(deployProvider);
    }
    
    console.log(chalk.blue('🔐 Authenticating with selected production services...'));
    
    // Use the first service for auth status check (they share auth state)
    const authStatus = await checkAuthenticationStatus(servicesToAuthenticate[0] || 'firebase');
    await handleBatchAuthentication(authStatus, servicesToAuthenticate[0] || 'firebase', configData);
  }

  // Step 4: Setup services (mix of production and local)
  const config: ProjectConfig = {
    name,
    serviceSlug,
    directory,
    database: connectionFlags.database 
      ? await setupDatabaseWithRetry(getDatabaseProvider(options), undefined, options.fast, serviceSlug, configData)
      : { url: 'postgresql://postgres:password@localhost:5433/postgres', provider: 'other' as const },
    firebase: connectionFlags.auth 
      ? await setupFirebaseWithRetry(undefined, options.fast, serviceSlug, name, configData)
      : { 
          projectId: 'demo-project', 
          apiKey: 'demo-api-key', 
          messagingSenderId: 'demo-sender-id', 
          appId: 'demo-app-id', 
          measurementId: 'demo-measurement-id',
          allowAnonymous: true
        },
    cloudflare: connectionFlags.deploy 
      ? await setupCloudflare(serviceSlug, options.fast || false, configData)
      : { workerName: sanitizeWorkerName(`${serviceSlug}-local`) }
  };

  // Step 5: Generate modular configuration files
  const configSpinner = ora({
    text: 'Generating configuration files...',
    spinner: 'line'
  }).start();
  
  try {
    await generateModularConfigFiles(config, connectionFlags);
    configSpinner.succeed('Configuration files generated');
  } catch (error) {
    configSpinner.fail('Failed to generate configuration files');
    throw error;
  }

  // Step 6: Run post-setup (always needed - local mode needs embedded PostgreSQL setup)
  const postSetupSpinner = ora({
    text: 'Running post-setup tasks...',
    spinner: 'line'
  }).start();
  
  let postSetupSucceeded = false;
  try {
    await execPnpm(['post-setup'], { 
      cwd: directory, 
      stdio: options.verbose ? 'inherit' : 'pipe' 
    });
    postSetupSpinner.succeed('Post-setup completed successfully!');
    postSetupSucceeded = true;
  } catch (error) {
    postSetupSpinner.fail('Post-setup failed');
    
    // Check if this is a database setup failure (exit code 1 from our post-setup script)
    // If so, the post-setup script already showed the appropriate error message
    if (error && typeof error === 'object' && 'code' in error && error.code === 1) {
      // Don't show additional error messages - the post-setup script already handled this
      // Exit completely when database setup fails
      process.exit(1);
    }
    
    logger.error('Failed to complete project setup');
    logger.debug(`Post-setup error: ${error}`);
    process.exit(1);
  }

  // Step 7: Success/Status message
  logger.newLine();
  
  if (postSetupSucceeded) {
    if (isFullLocal) {
      logger.success('🎉 Your local volo-app has been created successfully!');
    } else if (isFullProduction) {
      logger.success('🎉 Your production-ready volo-app has been created successfully!');
    } else {
      logger.success('🎉 Your modular volo-app has been created successfully!');
    }
  } else {
    logger.warning('⚠️  Your volo-app was created but setup is incomplete');
    logger.info('The project files are ready, but post-setup configuration failed.');
  }
  
  logger.newLine();
  
  console.log(chalk.cyan.bold('🚀 What you got:'));
  console.log(chalk.white('  • React + TypeScript + Tailwind CSS + ShadCN frontend'));
  console.log(chalk.white('  • Hono API backend for Cloudflare Workers'));
  
  if (connectionFlags.auth) {
    console.log(chalk.white('  • Firebase Authentication (production)'));
  } else {
    console.log(chalk.white('  • Firebase Authentication (local emulator)'));
  }
  
  if (connectionFlags.database) {
    console.log(chalk.white('  • PostgreSQL database (production)'));
  } else {
    console.log(chalk.white('  • PostgreSQL database (embedded local)'));
  }
  
  if (connectionFlags.deploy) {
    console.log(chalk.white('  • Cloudflare Workers deployment (API + static assets)'));
  } else {
    console.log(chalk.white('  • Local development ready'));
  }
  
  logger.newLine();
  
  const cdPath = isCurrentDirectory ? null : path.relative(process.cwd(), directory);

  if (postSetupSucceeded) {
    console.log(chalk.green.bold('▶️  Next steps:'));
    if (cdPath) {
      console.log(chalk.cyan(`   cd ${cdPath}`));
    }
    console.log(chalk.cyan('   pnpm run dev'));
  } else {
    console.log(chalk.yellow.bold('🔧 Fix setup issues first:'));
    if (cdPath) {
      console.log(chalk.cyan(`   cd ${cdPath}`));
    }
    console.log(chalk.cyan('   pnpm post-setup'));
    console.log(chalk.gray('   Then run: pnpm run dev'));
  }
  
  // Show connection upgrade options only for non-full-production setups
  if (!isFullProduction) {
    const remainingConnections = [];
    if (!connectionFlags.auth) remainingConnections.push('connect:auth');
    if (!connectionFlags.database) remainingConnections.push('connect:database');
    if (!connectionFlags.deploy) remainingConnections.push('connect:deploy');
    
    if (remainingConnections.length > 0) {
      logger.newLine();
      console.log(chalk.yellow.bold('🔗 Connect additional services later:'));
      remainingConnections.forEach(service => {
        console.log(chalk.cyan(`   pnpm ${service}`));
      });
    }
  }
  
  logger.newLine();
  
  // Ask if user wants to start the app now (only if setup succeeded)
  if (postSetupSucceeded) {
    const startNow = await askToStartDevelopmentServer(configData);

    if (startNow) {
    logger.newLine();
    console.log(chalk.green('🚀 Starting your volo-app...'));
    logger.newLine();
    
    try {
      await execPnpmDetached(['run', 'dev'], { cwd: directory });
      
      // Wait a moment to see if the process starts successfully
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      logger.newLine();
      
      if (connectionFlags.auth && config.firebase.projectId !== 'demo-project') {
        console.log(chalk.white(`  • Firebase Console: https://console.firebase.google.com/project/${config.firebase.projectId}`));
      }
      
      // Add Firebase emulator sign-in tip for local auth
      if (!connectionFlags.auth && config.firebase.projectId === 'demo-project') {
        logger.newLine();
        console.log(chalk.yellow('💡 Sign in with any user/password combo. This will be stored in your local Firebase Auth emulator.'));
        console.log(chalk.gray('   *Note: Sign In with Google only works when using the full production Firebase Auth integration.*'));
      }
      
      logger.newLine();
      console.log(chalk.yellow('💡 The development server is running.'));
      console.log(chalk.gray('   Press Ctrl+C to stop it.'));
      
    } catch (error) {
      logger.error('Failed to start the development server');
      logger.info('You can start it manually by running:');
      if (cdPath) {
        console.log(chalk.cyan(`   cd ${cdPath}`));
      }
      console.log(chalk.cyan('   pnpm run dev'));
    }
    }
  } else {
    // Post-setup failed, show troubleshooting guidance
    logger.newLine();
    console.log(chalk.yellow.bold('🛠️  Troubleshooting:'));
    console.log(chalk.white('Complete the setup first, then you can start your app:'));
    if (cdPath) {
      console.log(chalk.cyan(`   cd ${cdPath}`));
    }
    console.log(chalk.cyan('   pnpm post-setup'));
    console.log(chalk.cyan('   pnpm run dev'));
  }
}

function getDatabaseProvider(options: CreateOptions): string | undefined {
  if (typeof options.database === 'string') return options.database;
  return options.fast ? 'neon' : undefined;
}

function getDeployProvider(options: CreateOptions): string {
  if (typeof options.deploy === 'string') return options.deploy;
  return 'cloudflare';
}

