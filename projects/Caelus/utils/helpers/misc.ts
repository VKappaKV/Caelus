import inquirer from 'inquirer';
import { VALIDATOR_APP_ID } from './account';

export function decodeBase64ToUint8Array(base64: string): Uint8Array {
  const binary = Buffer.from(base64, 'base64');
  return new Uint8Array(binary);
}

export async function getAmount(): Promise<number> {
  const { amount } = await inquirer.prompt([
    {
      type: 'input',
      name: 'amount',
      message: 'Enter amount: ',
      validate: (input) => !Number.isNaN(Number(input)) || 'Must be a valid number',
    },
  ]);
  return Number(amount);
}

export const confirmation = () => {
  return inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Are you sure?',
      default: false,
    },
  ]);
};

export const defaultOrInput = async (defaultValue: string[]): Promise<boolean> => {
  const { input } = await inquirer.prompt([
    {
      type: 'input',
      name: 'input',
      message: `do you want to use default or new address?: \n Defaults: ${defaultValue.join(', ')}`,
      choice: ['default', 'new'],
    },
  ]);
  return input === 'default';
};

export const pickFromList = async (message: string, choices: string[]) => {
  const { selection } = await inquirer.prompt([
    {
      type: 'list',
      name: 'selection',
      message,
      choices,
    },
  ]);
  return selection;
};

export async function getAddress(): Promise<string> {
  let requestAddress: string;

  const { choice } = await inquirer.prompt([
    {
      type: 'list',
      name: 'choice',
      message: `Do you want to use the validator address from the config file or enter it manually? \t found: ${VALIDATOR_APP_ID}`,
      choices: [
        { name: `Use ${VALIDATOR_APP_ID}`, value: 'config' },
        { name: 'Enter manually', value: 'manual' },
      ],
    },
  ]);
  switch (choice) {
    case 'config': {
      const address = VALIDATOR_APP_ID;
      if (!address) {
        throw new Error(`No validator address found in config file`);
      }
      requestAddress = address;
      break;
    }
    case 'manual': {
      requestAddress = await inquirer.prompt([
        {
          type: 'input',
          name: 'address',
          message: `Enter address`,
        },
      ]).ui.answers.address;
      break;
    }
    default:
      throw new Error('Invalid choice');
  }
  return requestAddress;
}
