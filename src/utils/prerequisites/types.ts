export interface Prerequisite {
  name: string;
  command: string;
  version?: string;
  minVersion?: string;
  installUrl: string;
  description: string;
  checkVersion?: (output: string) => string | null;
  optional?: boolean;
  canInstallLocally?: boolean;
  canInstallGlobally?: boolean;
  npmPackage?: string;
  systemTool?: boolean; // For tools that need system-level installation
}

export interface PrerequisiteOptions {
  autoInstall?: boolean;
  databasePreference?: string;
  fastMode?: boolean;
  productionMode?: boolean;
  includeDeployPrerequisites?: boolean;
}

export type CliInstallResult = 'global' | 'local' | false;

export interface PrerequisiteResult {
  status: 'ok' | 'missing' | 'outdated' | 'installed_locally';
  currentVersion?: string | null;
}

export interface CheckPrerequisitesResult {
  databasePreference?: string;
  databaseConfig?: any;
} 