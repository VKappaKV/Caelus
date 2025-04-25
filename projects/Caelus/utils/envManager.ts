import { writeFileSync, readFileSync, existsSync } from 'fs';

export const updateEnvVariable = (key: string, value: string) => {
  const envPath = '../../.env';
  let envContent = '';

  if (existsSync(envPath)) {
    envContent = readFileSync(envPath, 'utf-8');
    const regex = new RegExp(`^${key}=.*$`, 'm');

    if (envContent.match(regex)) {
      // Replace existing key
      envContent = envContent.replace(regex, `${key}=${value}`);
    } else {
      // Append new key
      envContent += `\n${key}=${value}`;
    }
  } else {
    // Create a new .env file
    envContent = `${key}=${value}\n`;
  }

  writeFileSync(envPath, envContent);
};
