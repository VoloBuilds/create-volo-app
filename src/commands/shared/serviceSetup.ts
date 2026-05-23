import inquirer from 'inquirer';
import chalk from 'chalk';
import { logger } from '../../utils/logger.js';
import { setupFirebase, FirebaseProjectIdConflictError, FirebaseTermsOfServiceError, FirebaseFirstTimeSetupError } from '../../services/firebase.js';
import { setupDatabase } from '../../services/database.js';
import { ProjectConfig } from '../shared/types.js';
import { askToRetrySetup } from '../shared/prompts.js';
import type { VoloConfig } from '../../utils/config.js';

export async function setupFirebaseWithRetry(maxRetries = 2, fastMode = false, serviceSlug?: string, displayName?: string, configData?: VoloConfig): Promise<ProjectConfig['firebase']> {
  // In config mode, fail fast: do not retry on errors.
  const effectiveMaxRetries = configData ? 1 : maxRetries;
  for (let attempt = 1; attempt <= effectiveMaxRetries; attempt++) {
    try {
      return await setupFirebase(fastMode, serviceSlug, displayName, configData);
    } catch (error) {
      // Handle Firebase first-time setup requirement
      if (error instanceof FirebaseFirstTimeSetupError) {
        logger.error('Firebase first-time setup required - please create your first project manually');
        throw error;
      }

      const isLastAttempt = attempt === effectiveMaxRetries;

      // Handle Firebase Terms of Service errors specially
      if (error instanceof FirebaseTermsOfServiceError) {
        logger.warning(`Firebase setup failed (attempt ${attempt}/${effectiveMaxRetries}) - Terms of Service required`);

        if (isLastAttempt) {
          logger.error('Firebase setup failed after multiple attempts - Terms of Service not accepted');
          throw error;
        }

        const { retry } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'retry',
            message: 'Have you accepted the Google Cloud Terms of Service and want to retry?',
            default: false
          }
        ]);

        if (!retry) {
          logger.info('Please accept the Terms of Service and run the create command again when ready.');
          throw error;
        }

        logger.info('Retrying Firebase setup...');
        continue;
      }

      // Handle Firebase project ID conflicts specially
      if (error instanceof FirebaseProjectIdConflictError) {
        logger.warning(`Firebase setup failed (attempt ${attempt}/${effectiveMaxRetries}) - Project ID already exists`);

        if (isLastAttempt) {
          logger.error('Firebase setup failed after multiple attempts - try a different project name');
          throw error;
        }

        const retry = await askToRetrySetup('Firebase');
        if (!retry) {
          throw error;
        }

        logger.info('Retrying Firebase setup...');
        continue;
      }

      // Handle other Firebase errors
      logger.warning(`Firebase setup failed (attempt ${attempt}/${effectiveMaxRetries})`);

      if (isLastAttempt) {
        logger.error('Firebase setup failed after multiple attempts');
        logger.newLine();
        console.log(chalk.yellow.bold('⚡ Manual Firebase setup required:'));
        console.log(chalk.cyan('   Visit https://console.firebase.google.com and create a project manually'));
        logger.newLine();
        throw error;
      }

      const retry = await askToRetrySetup('Firebase');
      if (!retry) {
        throw error;
      }

      logger.info('Retrying Firebase setup...');
    }
  }

  throw new Error('Firebase setup failed');
}

export async function setupDatabaseWithRetry(databasePreference?: string, maxRetries = 2, fastMode = false, serviceSlug?: string, configData?: VoloConfig): Promise<ProjectConfig['database']> {
  // In config mode, fail fast: do not retry on errors.
  const effectiveMaxRetries = configData ? 1 : maxRetries;
  for (let attempt = 1; attempt <= effectiveMaxRetries; attempt++) {
    try {
      switch (databasePreference) {
        case 'neon':
          return await setupDatabase(databasePreference, fastMode, serviceSlug, configData);
        case 'supabase':
          const { setupSupabaseDatabase } = await import('../../services/supabase.js');
          return await setupSupabaseDatabase(fastMode, serviceSlug, configData);
        case 'other':
          const { setupOtherDatabase } = await import('../../services/database.js');
          return await setupOtherDatabase(configData);
        default:
          return await setupDatabase(databasePreference, fastMode, serviceSlug, configData);
      }
    } catch (error) {
      logger.warning(`Database setup failed (attempt ${attempt}/${effectiveMaxRetries})`);

      if (attempt === effectiveMaxRetries) {
        logger.error('Database setup failed after multiple attempts');
        logger.newLine();
        console.log(chalk.yellow.bold('⚡ Manual database setup required:'));
        console.log(chalk.cyan('   1. Create a PostgreSQL database (Neon, Supabase, or other)'));
        console.log(chalk.cyan('   2. Update DATABASE_URL in server/.dev.vars'));
        console.log(chalk.cyan('   3. Run: cd server && pnpm run db:push'));
        logger.newLine();
        throw error;
      }

      const retry = await askToRetrySetup('database');
      if (!retry) {
        throw error;
      }

      logger.info('Retrying database setup...');
    }
  }

  throw new Error('Database setup failed');
} 