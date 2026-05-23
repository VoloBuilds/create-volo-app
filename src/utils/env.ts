import dotenv from 'dotenv';

/**
 * Parses a .env file's text content into a key-value map (does not mutate process.env).
 */
export function parseEnvFile(content: string): Record<string, string> {
  return dotenv.parse(content);
}
