import { writeFileSync, readFileSync, existsSync } from 'fs';

export const updateEnvVariable = (key: string, value: string) => {
  const envPath = '../../.env';
  let envContent = '';

  if (existsSync(envPath)) {
    envContent = readFileSync(envPath, 'utf-8');
    const regex = new RegExp(`^${key}=.*$`, 'm');

    if (envContent.match(regex)) {
      envContent = envContent.replace(regex, `${key}=${value}`);
    } else {
      envContent += `\n${key}=${value}`;
    }
  } else {
    envContent = `${key}=${value}\n`;
  }

  writeFileSync(envPath, envContent);
};
