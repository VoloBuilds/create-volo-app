import { execa } from 'execa';
import semver from 'semver';
import ora from 'ora';
import type { CliInstallResult, Prerequisite, PrerequisiteResult } from './types.js';
import { logger } from '../logger.js';

export async function installCliTool(prereq: Prerequisite, global: boolean = false): Promise<CliInstallResult> {
  if (!prereq.npmPackage) {
    return false;
  }

  const installType = global ? 'globally' : 'locally';
  const spinner = ora(`Installing ${prereq.name} ${installType}...`).start();
  
  try {
    const args = global 
      ? ['install', '-g', prereq.npmPackage]
      : ['install', prereq.npmPackage, '--no-save'];
    
    await execa('npm', args, {
      stdio: 'pipe',
      cwd: process.cwd()
    });
    
    spinner.succeed(`${prereq.name} installed ${installType}`);
    return global ? 'global' : 'local';
  } catch (error) {
    // If global install fails due to permissions, suggest local install
    if (global && error instanceof Error && (error.message.includes('EACCES') || error.message.includes('permission denied'))) {
      spinner.fail(`${prereq.name} global install failed (permission denied)`);
      logger.debug(`Global installation permission error: ${error}`);
      
             // Show helpful message for Mac users
       if (process.platform === 'darwin') {
         logger.info(`💡 On Mac, you can fix this by running: sudo npm install -g ${prereq.npmPackage}`);
         logger.info(`   But we'll proceed with local install (works just as well)`);
       }
      
      // Try local installation as fallback
      if (prereq.canInstallLocally) {
        const localSpinner = ora(`Trying ${prereq.name} local installation...`).start();
        try {
          await execa('npm', ['install', prereq.npmPackage, '--no-save'], {
            stdio: 'pipe',
            cwd: process.cwd()
          });
          localSpinner.succeed(`${prereq.name} installed locally (global permissions unavailable)`);
          return 'local';
        } catch (localError) {
          localSpinner.fail(`${prereq.name} local installation also failed`);
          logger.debug(`Local installation error: ${localError}`);
          return false;
        }
      }
      return false;
    }
    
    spinner.fail(`Failed to install ${prereq.name} ${installType}`);
    logger.debug(`Installation error: ${error}`);
    return false;
  }
}

export async function checkLocalCliTool(prereq: Prerequisite): Promise<PrerequisiteResult> {
  if (!prereq.canInstallLocally || !prereq.npmPackage) {
    return { status: 'missing' };
  }

  // Skip npx check for bundled dependencies to avoid nested npx calls
  if (prereq.command === 'skip') {
    return { status: 'ok', currentVersion: 'bundled' };
  }

  try {
    // Try to run the locally installed CLI tool via npx
    const { stdout } = await execa('npx', [prereq.command, prereq.version || '--version'], {
      stdio: 'pipe',
      timeout: 10000
    });
    
    const currentVersion = prereq.checkVersion ? prereq.checkVersion(stdout) : stdout.trim();
    
    if (currentVersion && prereq.minVersion && !semver.gte(currentVersion, prereq.minVersion)) {
      return { status: 'missing' }; // Treat outdated local version as missing
    }
    
    return { status: 'ok', currentVersion };
  } catch (error) {
    logger.debug(`Local ${prereq.name} check failed: ${error}`);
    return { status: 'missing' };
  }
} 