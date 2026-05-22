import inquirer from 'inquirer';
import chalk from 'chalk';
import { logger } from '../../utils/logger.js';
import type { VoloConfig } from '../../utils/config.js';

export async function askToStartDevelopmentServer(configData?: VoloConfig): Promise<boolean> {
  if (configData) return false;

  const { startNow } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'startNow',
      message: 'Would you like to start the development server now?',
      default: true
    }
  ]);

  return startNow;
}

export async function askToProceedWithAuthentication(needsAuth: string[], configData?: VoloConfig): Promise<boolean> {
  if (configData) return true;

  logger.newLine();
  console.log(chalk.yellow.bold('🔐 Authentication Required'));
  console.log(chalk.white(`We need to authenticate with ${needsAuth.length} service${needsAuth.length > 1 ? 's' : ''}:`));
  
  for (const service of needsAuth) {
    console.log(chalk.white(`  • ${service}`));
  }
  
  logger.newLine();
  console.log(chalk.white('This will open browser tabs for secure authentication.'));
  console.log(chalk.white('Each authentication takes about 30 seconds.'));
  logger.newLine();

  const { proceed } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'proceed',
      message: `Open ${needsAuth.length} browser tab${needsAuth.length > 1 ? 's' : ''} for authentication?`,
      default: true
    }
  ]);

  return proceed;
}

export async function askToRetrySetup(serviceName: string): Promise<boolean> {
  const { retry } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'retry',
      message: `Would you like to retry ${serviceName} setup?`,
      default: true
    }
  ]);

  return retry;
} 