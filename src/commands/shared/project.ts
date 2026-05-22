import inquirer from 'inquirer';
import path from 'path';
import fs from 'fs-extra';
import { logger } from '../../utils/logger.js';
import type { VoloConfig } from '../../utils/config.js';

interface ProjectInfo {
  name: string;
  directory: string;
  isCurrentDirectory: boolean;
}

export async function getProjectName(provided?: string, configData?: VoloConfig): Promise<ProjectInfo> {
  if (!provided && configData?.projectName) {
    provided = configData.projectName;
  }

  if (provided) {
    const resolved = path.resolve(provided);
    const name = path.basename(resolved);
    const isCurrentDirectory = resolved === path.resolve();
    return { name, directory: resolved, isCurrentDirectory };
  }

  const { input } = await inquirer.prompt([
    {
      type: 'input',
      name: 'input',
      message: 'What is your project name?',
      default: 'my-volo-app',
      validate: (val: string) => {
        if (!val.trim()) {
          return 'Project name is required';
        }
        return true;
      }
    }
  ]);

  const resolved = path.resolve(input);
  const name = path.basename(resolved);
  const isCurrentDirectory = resolved === path.resolve();
  return { name, directory: resolved, isCurrentDirectory };
}

export async function validateAndPrepareDirectory(directory: string, isCurrentDirectory: boolean = false, configData?: VoloConfig): Promise<string> {
  if (isCurrentDirectory) {
    const files = await fs.readdir(directory);
    const significantFiles = files.filter(file => 
      !file.startsWith('.') && 
      file !== 'README.md' && 
      file !== 'package.json' && 
      file !== 'node_modules'
    );

    if (significantFiles.length > 0) {
      const overwrite = configData
        ? true
        : (await inquirer.prompt([
            {
              type: 'confirm',
              name: 'overwrite',
              message: `Current directory is not empty. Do you want to continue and potentially overwrite existing files?`,
              default: false
            }
          ])).overwrite;

      if (!overwrite) {
        logger.info('Operation cancelled.');
        throw new Error('Directory is not empty');
      }
    }
  } else {
    if (await fs.pathExists(directory)) {
      const displayName = path.basename(directory);
      const overwrite = configData
        ? true
        : (await inquirer.prompt([
            {
              type: 'confirm',
              name: 'overwrite',
              message: `Directory "${displayName}" already exists. Do you want to overwrite it?`,
              default: false
            }
          ])).overwrite;

      if (!overwrite) {
        logger.info('Operation cancelled.');
        throw new Error('Directory already exists');
      }

      await fs.remove(directory);
    }
  }

  return directory;
} 