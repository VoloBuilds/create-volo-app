/**
 * Parses a .env file's text content into a key-value map.
 * Lines beginning with '#' and empty lines are ignored.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const envVars: Record<string, string> = {};

  content.split('\n').forEach(line => {
    const cleanLine = line.trim();
    if (cleanLine && !cleanLine.startsWith('#')) {
      const [key, ...valueParts] = cleanLine.split('=');
      if (key && valueParts.length > 0) {
        envVars[key.trim()] = valueParts.join('=').trim();
      }
    }
  });

  return envVars;
}
