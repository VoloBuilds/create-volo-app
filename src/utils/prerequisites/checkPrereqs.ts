import { execa } from 'execa';
import which from 'which';
import semver from 'semver';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { logger } from '../logger.js';
import type { 
  Prerequisite, 
  PrerequisiteOptions, 
  PrerequisiteResult, 
  CheckPrerequisitesResult 
} from './types.js';
import { corePrerequisites, databasePrerequisites, deploymentPrerequisites } from './prereqList.js';
import { checkNetworkConnectivity } from './networkCheck.js';
import { installCliTool, checkLocalCliTool } from './installCLIs.js';
import { checkDatabaseChoice, displayManualInstallInstructions } from './userInstructions.js';

async function checkPrerequisite(prereq: Prerequisite): Promise<PrerequisiteResult> {
  try {
    // Handle bundled dependencies that don't need CLI checks
    if (prereq.command === 'skip' && prereq.version === 'skip') {
      return { status: 'ok', currentVersion: 'bundled' };
    }
    
    // First, check if command exists globally
    if (prereq.command === 'skip') {
      return { status: 'ok', currentVersion: 'available via npx' };
    }

    // Try to find global installation
    let globalFound = false;
    let globalVersion: string | null = null;
    
    try {
      const commandPath = await which(prereq.command);
      logger.debug(`Found ${prereq.name} globally at: ${commandPath}`);
      globalFound = true;
    } catch (error) {
      logger.debug(`${prereq.name} not found globally: ${error}`);
      globalFound = false;
    }

    // If found, try to check version
    if (globalFound && prereq.version) {
      try {
        const { stdout } = await execa(prereq.command, [prereq.version], {
          timeout: 10000, // 10 second timeout to prevent hanging
          reject: true
        });
        globalVersion = prereq.checkVersion ? prereq.checkVersion(stdout) : stdout.trim();

        if (globalVersion) {
          logger.debug(`Global ${prereq.name} version: ${globalVersion}`);

          if (prereq.minVersion && !semver.gte(globalVersion, prereq.minVersion)) {
            // Global version is outdated, check if we can use/install local version
            if (prereq.canInstallLocally) {
              const localResult = await checkLocalCliTool(prereq);
              if (localResult.status === 'ok') {
                return { status: 'installed_locally', currentVersion: localResult.currentVersion };
              }
              // Will offer to install locally below
            } else {
              return { status: 'outdated', currentVersion: globalVersion };
            }
          } else {
            return { status: 'ok', currentVersion: globalVersion };
          }
        }
      } catch (error: any) {
        // Handle timeout errors specially - likely means CLI needs auth or has issues
        if (error.timedOut) {
          logger.debug(`${prereq.name} version check timed out`);
          
          // For CLIs that require authentication (like neonctl), timeout might mean not authenticated
          // Still report as OK but we'll check auth separately
          if (prereq.command === 'neonctl' || prereq.command === 'supabase') {
            logger.debug(`${prereq.name} found but version check timed out - may need authentication`);
            return { status: 'ok', currentVersion: 'installed (authentication required)' };
          }
        }
        
        logger.debug(`${prereq.name} found but failed to run: ${error}`);
        // Global binary exists but version check failed — prefer global over bundled local copies
        if (globalFound) {
          return { status: 'ok', currentVersion: 'installed globally' };
        }
        // Try local installation if available
        if (prereq.canInstallLocally) {
          const localResult = await checkLocalCliTool(prereq);
          if (localResult.status === 'ok') {
            return { status: 'installed_locally', currentVersion: localResult.currentVersion };
          }
        }
        return { status: 'missing' };
      }
    } else if (globalFound && !prereq.version) {
      return { status: 'ok' };
    }

    // If global not found or outdated, check for local installation
    if (prereq.canInstallLocally) {
      const localResult = await checkLocalCliTool(prereq);
      if (localResult.status === 'ok') {
        return { status: 'installed_locally', currentVersion: localResult.currentVersion };
      }
    }

    // Neither global nor local found
    return { status: 'missing' };
    
  } catch (error) {
    logger.debug(`${prereq.name} check failed: ${error}`);
    return { status: 'missing' };
  }
}

/**
 * Whether to run the local-only → global CLI upgrade flow.
 * - Interactive: offer upgrade (with prompt).
 * - Fast / config mode: auto-upgrade without prompt.
 * - autoInstall without fastMode: skip (missing tools handled in the missing-prereq block).
 */
function shouldUpgradeLocalClisToGlobal(options: PrerequisiteOptions): boolean {
  if (options.fastMode) {
    return true;
  }
  if (options.autoInstall) {
    return false;
  }
  return true;
}

export async function checkPrerequisites(options: PrerequisiteOptions = {}): Promise<CheckPrerequisitesResult> {
  // Fast mode implies auto-install: skip prompts and accept sensible defaults.
  if (options.fastMode) {
    options.autoInstall = true;
  }

  const hasNetwork = await checkNetworkConnectivity();
  if (!hasNetwork) {
    logger.warning('No internet connection detected. Some features may not work properly.');
    logger.info('Please ensure you have a stable internet connection and try again.');

    const continueOffline = options.fastMode
      ? true
      : (await inquirer.prompt([
          {
            type: 'confirm',
            name: 'continueOffline',
            message: 'Continue anyway? (You can set up services manually later)',
            default: false
          }
        ])).continueOffline;

    if (!continueOffline) {
      process.exit(1);
    }
  }

  // Build prerequisites list based on mode
  let prerequisites = [...corePrerequisites];
  let databaseChoice: string | null = null;
  
  if (options.productionMode) {
    // Production mode: check all prerequisites including database CLIs
    // Check database preference for CLI validation
    
    if (options.databasePreference) {
      // Use provided database preference
      databaseChoice = options.databasePreference;
      logger.info(`Using database provider: ${databaseChoice}`);
    } else if (options.fastMode) {
      // Default to Neon in fast mode
      databaseChoice = 'neon';
      logger.info('Fast mode: Using Neon as database provider');
    } else {
      // Ask user for preference
      databaseChoice = await checkDatabaseChoice();
    }
    
    if (databaseChoice && databasePrerequisites[databaseChoice]) {
      prerequisites.push(databasePrerequisites[databaseChoice]);
      logger.info(`Database choice "${databaseChoice}" requires: ${databasePrerequisites[databaseChoice].name}`);
    } else if (databaseChoice) {
      logger.info(`Database choice "${databaseChoice}" - no additional CLI tools required`);
    } else {
      logger.info('No database provider selected - skipping database CLI checks');
    }

    if (options.includeDeployPrerequisites && deploymentPrerequisites.cloudflare) {
      prerequisites.push(deploymentPrerequisites.cloudflare);
    }
  } else {
    // Local mode: only check core prerequisites (Node.js, pnpm, Git)
    // Skip database CLI checks since local mode uses embedded PostgreSQL
    prerequisites = prerequisites.filter(prereq => ['node', 'pnpm', 'git'].includes(prereq.command));
    logger.info('Local development mode: checking core tools only (Node.js, pnpm, Git)');
  }

  let recheckNeeded = true;
  const justInstalledLocally = new Set<string>(); // Track tools installed locally in this session
  const declinedGlobalUpgrade = new Set<string>(); // Track tools user declined to upgrade globally
  
  while (recheckNeeded) {
    recheckNeeded = false;
    
    logger.newLine();
    logger.info('Checking required tools...');
    logger.newLine();

    const missing: Prerequisite[] = [];
    const outdated: { prereq: Prerequisite; currentVersion: string }[] = [];
    const localOnly: { prereq: Prerequisite; currentVersion: string }[] = [];

    for (const prereq of prerequisites) {
      const result = await checkPrerequisite(prereq);
      
      switch (result.status) {
        case 'ok':
          logger.success(`${prereq.name} ${result.currentVersion || ''} ✓`);
          break;
        case 'missing':
          if (prereq.optional) {
            logger.warning(`${prereq.name} not found (optional - can be installed later)`);
          } else {
            missing.push(prereq);
          }
          break;
        case 'outdated':
          outdated.push({ prereq, currentVersion: result.currentVersion! });
          break;
        case 'installed_locally':
          logger.success(`${prereq.name} ${result.currentVersion || ''} ✓ (installed locally)`);
          // Only track for upgrade if not just installed locally in this session
          if (prereq.canInstallGlobally && !justInstalledLocally.has(prereq.name) && !declinedGlobalUpgrade.has(prereq.name)) {
            localOnly.push({ prereq, currentVersion: result.currentVersion! });
          }
          break;
      }
    }

    // Handle tools that are only available locally but could be installed globally.
    if (localOnly.length > 0 && shouldUpgradeLocalClisToGlobal(options)) {
      logger.newLine();
      console.log(chalk.cyan.bold('🔄 Local Installation Detected'));
      logger.newLine();
      
      console.log(chalk.white('The following tools are installed locally but could be installed globally for better convenience:'));
      logger.newLine();
      
      for (const { prereq, currentVersion } of localOnly) {
        console.log(chalk.cyan(`📦 ${prereq.name} ${currentVersion} (currently local only)`));
        console.log(chalk.gray(`   ${prereq.description}`));
        console.log('');
      }
      
      console.log(chalk.white('Benefits of global installation:'));
      console.log(chalk.white('  • Available in any directory without npx'));
      console.log(chalk.white('  • Faster execution (no npx overhead)'));
      console.log(chalk.white('  • Better IDE integration'));
      logger.newLine();

      const upgradeToGlobal = options.fastMode
        ? true
        : (await inquirer.prompt([
            {
              type: 'confirm',
              name: 'upgradeToGlobal',
              message: 'Would you like to install these tools globally?',
              default: true
            }
          ])).upgradeToGlobal;

      if (upgradeToGlobal) {
        logger.newLine();
        logger.info('Installing CLI tools globally...');
        logger.newLine();
        
        const failedInstalls: Prerequisite[] = [];
        let globalInstallCount = 0;
        let localFallbackCount = 0;
        
        for (const { prereq } of localOnly) {
          const result = await installCliTool(prereq, true); // Install globally
          if (result === 'global') {
            globalInstallCount++;
          } else if (result === 'local') {
            localFallbackCount++;
            justInstalledLocally.add(prereq.name);
          } else {
            failedInstalls.push(prereq);
            justInstalledLocally.add(prereq.name);
          }
        }
        
        logger.newLine();
        if (globalInstallCount > 0 && failedInstalls.length === 0 && localFallbackCount === 0) {
          logger.success('All CLI tools installed globally! ✨');
          logger.newLine();
          console.log(chalk.green('🎉 Your tools are now available system-wide.'));
          console.log(chalk.white('You may need to restart your terminal for PATH changes to take effect.'));
        } else if (globalInstallCount > 0) {
          logger.success('Some CLI tools were installed globally.');
          if (localFallbackCount > 0) {
            logger.info(`${localFallbackCount} tool(s) will continue using local installation (global permissions unavailable).`);
          }
        } else if (localFallbackCount > 0) {
          logger.info('Global install unavailable — continuing with local CLI installations.');
        } else {
          logger.warning('Some tools couldn\'t be installed globally:');
          for (const prereq of failedInstalls) {
            console.log(chalk.yellow(`  • ${prereq.name} (will continue using local version)`));
          }
        }
        
        // Recheck after installation
        recheckNeeded = true;
        continue;
      } else {
        for (const { prereq } of localOnly) {
          declinedGlobalUpgrade.add(prereq.name);
        }
      }
    }

    // Handle missing prerequisites
    if (missing.length > 0) {
      logger.newLine();
      
      // Separate missing tools into categories
      const canInstallViaNpm = missing.filter(p => p.canInstallLocally || p.canInstallGlobally);
      const systemTools = missing.filter(p => p.systemTool && !p.npmPackage);
      
      if (canInstallViaNpm.length > 0) {
        logger.info('Missing CLI tools that can be installed automatically:');
        logger.newLine();
        
        for (const prereq of canInstallViaNpm) {
          console.log(chalk.yellow(`⚠️  ${prereq.name}`));
          console.log(chalk.gray(`   ${prereq.description}`));
          console.log('');
        }
        
        let installChoice = 'none';
        
        if (options.autoInstall) {
          installChoice = 'global';
        } else {
          const choices = [];
          
          // Check if any tools support global installation
          const canInstallGlobally = canInstallViaNpm.some(p => p.canInstallGlobally);
          if (canInstallGlobally) {
            choices.push({
              name: 'Install globally (recommended - available system-wide)',
              value: 'global'
            });
          }
          
          // Check if any tools support local installation
          const canInstallLocally = canInstallViaNpm.some(p => p.canInstallLocally);
          if (canInstallLocally) {
            choices.push({
              name: 'Install locally (you\'ll need to do this again for each app)',
              value: 'local'
            });
          }
          
          choices.push({
            name: 'Don\'t install automatically (exit CLI)',
            value: 'none'
          });
          
          const response = await inquirer.prompt([
            {
              type: 'list',
              name: 'installChoice',
              message: 'How would you like to install the missing CLI tools?',
              choices
            }
          ]);
          installChoice = response.installChoice;
        }
        
        if (installChoice === 'none') {
          logger.info('Installation cancelled. Please install the missing tools manually and run create-volo-app again.');
          process.exit(1);
        }
        
        const isGlobal = installChoice === 'global';
        
        logger.newLine();
        logger.info(`Installing CLI tools ${isGlobal ? 'globally' : 'locally'}...`);
        logger.newLine();
        
        const failedInstalls: Prerequisite[] = [];
        let globalInstallCount = 0;
        let localInstallCount = 0;
        
        for (const prereq of canInstallViaNpm) {
          let installResult: 'global' | 'local' | false = false;
          
          // Try preferred installation method first
          if ((isGlobal && prereq.canInstallGlobally) || (!isGlobal && prereq.canInstallLocally)) {
            installResult = await installCliTool(prereq, isGlobal);
          }
          
          // If preferred method isn't supported or failed, try the alternative
          if (!installResult) {
            if (isGlobal && prereq.canInstallLocally) {
              logger.info(`${prereq.name} doesn't support global installation, trying local installation...`);
              installResult = await installCliTool(prereq, false); // Try local
            } else if (!isGlobal && prereq.canInstallGlobally) {
              logger.info(`${prereq.name} doesn't support local installation, trying global installation...`);
              installResult = await installCliTool(prereq, true); // Try global
            }
          }

          if (installResult === 'global') {
            globalInstallCount++;
          } else if (installResult === 'local') {
            localInstallCount++;
            justInstalledLocally.add(prereq.name);
          } else {
            failedInstalls.push(prereq);
          }
        }
        
        if (failedInstalls.length === 0) {
          logger.newLine();
          if (isGlobal && localInstallCount === 0) {
            logger.success('All CLI tools installed globally! ✨');
          } else if (isGlobal && localInstallCount > 0) {
            logger.success('CLI tools ready.');
            logger.info(`${localInstallCount} tool(s) installed locally (global permissions unavailable).`);
          } else {
            logger.success('All CLI tools installed locally! ✨');
          }
        } else {
          logger.newLine();
          logger.warning(`Some tools couldn't be installed automatically:`);
          for (const prereq of failedInstalls) {
            console.log(chalk.yellow(`  • ${prereq.name}`));
          }
          systemTools.push(...failedInstalls);
        }
      }
      
      if (systemTools.length > 0) {
        const shouldContinue = options.fastMode
          ? true
          : await displayManualInstallInstructions(systemTools);
        if (!shouldContinue) {
          recheckNeeded = true;
          continue;
        }
      }
    }

    // Handle outdated prerequisites
    if (outdated.length > 0) {
      logger.newLine();
      console.log(chalk.yellow.bold('⚠️  Outdated Tools Detected'));
      logger.newLine();

      for (const { prereq, currentVersion } of outdated) {
        console.log(chalk.yellow(`⚠️  ${prereq.name} ${currentVersion} (minimum: ${prereq.minVersion})`));
        console.log(chalk.gray(`   ${prereq.description}`));
        console.log(chalk.blue(`   Update from: ${prereq.installUrl}`));
        console.log('');
      }

      const shouldContinue = options.fastMode
        ? true
        : (await inquirer.prompt([
            {
              type: 'confirm',
              name: 'shouldContinue',
              message: 'Would you like to continue with outdated tools? (May cause issues)',
              default: false
            }
          ])).shouldContinue;

      if (!shouldContinue) {
        logger.info('Please update the outdated tools and run create-volo-app again.');
        process.exit(1);
      }
    }
  }

  logger.newLine();
  logger.success('Prerequisites check completed!');
  logger.newLine();

  return { databasePreference: databaseChoice || undefined, databaseConfig: undefined };
} 