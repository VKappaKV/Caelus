/* eslint-disable import/no-cycle */
/* eslint-disable no-await-in-loop */
/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable no-use-before-define */
/* eslint-disable no-console */
import inquirer from 'inquirer';
import { Config } from '@algorandfoundation/algokit-utils';
import * as dotenv from 'dotenv';
import { adminSetup, deploy, validatorSetup, update } from './helpers/bootstrap';
import { mint, mintOperatorCommit, addValidator, removeOperatorCommit, burn, bid, delegate } from './helpers/admin';
import { validatorOptIntoLST, goOnline, goOffline, migrate, claimDust } from './helpers/validator';
import { algorand } from './helpers/network';
import { runner } from './runner';

Config.configure({
  debug: true,
  traceAll: true,
});

const ADMIN = 'ADMIN';
const VALIDATOR = 'VALIDATOR';

dotenv.config();

const { ADMIN_APP_ID, VALIDATOR_APP_ID, MNEMONIC } = process.env;

if (!ADMIN_APP_ID || !VALIDATOR_APP_ID || !MNEMONIC || MNEMONIC === '') {
  throw new Error(
    'Remember to set the .env file, follow the structure in the .env.template file. Fill the MNEMONICs with the account mnemonics'
  );
}

export const getAccount = async () => {
  const testAccount = algorand.account.fromMnemonic(MNEMONIC);

  const random = algorand.account.random();

  return { testAccount, random };
};

async function main() {
  let admin: bigint = 0n;
  let validator: bigint = 0n;
  let action: string = '';
  while (action !== 'exit') {
    const pick = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: '\n What do you want to execute?',
        choices: [
          { name: 'Bootstrap (deploy contract + admin set up & validator contract inscription)', value: 'bootstrap' },
          { name: 'Deploy', value: 'deploy' },
          { name: 'Admin Setup', value: 'admin' },
          { name: 'Validator Contract inscription', value: 'validator' },
          { name: 'Spawn Validator', value: 'spawn' },
          { name: 'Update', value: 'update' },
          { name: 'Mint', value: 'mint' },
          { name: 'Mint (Operator Commit)', value: 'mintOperator' },
          { name: 'Burn', value: 'burn' },
          { name: 'Remove Operator Commit', value: 'burnOperator' },
          { name: 'Bid Validator', value: 'bidValidator' },
          { name: 'Delegate stake to validator', value: 'delegate' },
          { name: 'Migrate Pool', value: 'migratePool' },
          { name: 'Delete Operator', value: 'deleteOperator' },
          { name: 'Validator Pool Opt-In', value: 'poolOptIn' },
          { name: 'Claim Leftover Algos into the ', value: 'claimDustAlgos' },
          { name: 'Go Online', value: 'goOnline' },
          { name: 'Go Offline', value: 'goOffline' },
          { name: 'Init Runner Script', value: 'initRunner' },
          { name: 'Settings', value: 'settings' },
          { name: 'Exit', value: 'exit' },
        ],
      },
    ]);
    action = pick.action;

    switch (action) {
      case 'bootstrap': {
        const { confirm } = await confirmation();
        if (!confirm) {
          console.log('Aborted!');
          break;
        }
        const app = await deploy();
        await adminSetup(app);

        await new Promise<void>((resolve) => {
          setTimeout(() => resolve(), 1000);
        });

        await validatorSetup(app);
        break;
      }
      case 'deploy': {
        const { confirm } = await confirmation();
        if (!confirm) {
          console.log('Aborted!');
          break;
        }
        await deploy();
        break;
      }
      case 'admin': {
        const { confirm } = await confirmation();
        if (!confirm) {
          console.log('Aborted!');
          break;
        }
        const app = await getAppID(ADMIN, admin, validator);
        await adminSetup(BigInt(app));
        break;
      }
      case 'validator': {
        const { confirm } = await confirmation();
        if (!confirm) {
          console.log('Aborted!');
          break;
        }
        const app = await getAppID(ADMIN, admin, validator);
        await validatorSetup(BigInt(app));
        break;
      }
      case 'spawn': {
        const { confirm } = await confirmation();
        if (!confirm) {
          console.log('Aborted!');
          break;
        }
        const app = await getAppID(ADMIN, admin, validator);
        await addValidator(BigInt(app));
        break;
      }
      case 'update': {
        const { confirm } = await confirmation();
        if (!confirm) {
          console.log('Aborted!');
          break;
        }
        const app = await getAppID(ADMIN, admin, validator);
        await update(BigInt(app));
        break;
      }
      case 'mint': {
        const app = await getAppID(ADMIN, admin, validator);
        const amount = await getAmount();
        await mint(BigInt(app), amount);
        break;
      }
      case 'burn': {
        const app = await getAppID(ADMIN, admin, validator);
        const amount = await getAmount();
        await burn(BigInt(app), BigInt(amount));
        break;
      }
      case 'mintOperator': {
        const adminAppId = await getAppID(ADMIN, admin, validator);
        const validatorAppId = await getAppID(VALIDATOR, admin, validator);
        const amount = await getAmount();
        await mintOperatorCommit(BigInt(adminAppId), BigInt(validatorAppId), amount);
        break;
      }
      case 'burnOperator': {
        const adminAppId = await getAppID(ADMIN, admin, validator);
        const validatorAppId = await getAppID(VALIDATOR, admin, validator);
        const amount = await getAmount();
        await removeOperatorCommit(BigInt(validatorAppId), BigInt(adminAppId), amount);
        break;
      }
      case 'poolOptIn': {
        const validatorAppId = await getAppID(VALIDATOR, admin, validator);
        await validatorOptIntoLST(BigInt(validatorAppId));
        break;
      }
      case 'bidValidator': {
        const adminAppId = await getAppID(ADMIN, admin, validator);
        const validatorAppId = await getAppID(VALIDATOR, admin, validator);
        await bid(BigInt(adminAppId), BigInt(validatorAppId));
        break;
      }
      case 'delegate': {
        const adminAppId = await getAppID(ADMIN, admin, validator);
        const amount = await getAmount();
        await delegate(BigInt(adminAppId), amount);
        break;
      }
      case 'goOnline': {
        const validatorAppId = await getAppID(VALIDATOR, admin, validator);

        const partKeyInputs = await inquirer.prompt([
          {
            type: 'input',
            name: 'firstRound',
            message: 'First round:',
            validate: (input) => !Number.isNaN(Number(input)) || 'Must be a valid number',
          },
          {
            type: 'input',
            name: 'lastRound',
            message: 'Last round:',
            validate: (input) => !Number.isNaN(Number(input)) || 'Must be a valid number',
          },
          {
            type: 'input',
            name: 'keyDilution',
            message: 'Key dilution:',
            validate: (input) => !Number.isNaN(Number(input)) || 'Must be a valid number',
          },
          {
            type: 'input',
            name: 'selectionKey',
            message: 'Selection key (Base64):',
          },
          {
            type: 'input',
            name: 'votingKey',
            message: 'Voting key (Base64):',
          },
          {
            type: 'input',
            name: 'stateProofKey',
            message: 'State proof key (Base64):',
          },
        ]);

        const partKey = {
          firstRound: BigInt(partKeyInputs.firstRound),
          lastRound: BigInt(partKeyInputs.lastRound),
          keyDilution: BigInt(partKeyInputs.keyDilution),
          selectionKey: decodeBase64ToUint8Array(partKeyInputs.selectionKey),
          votingKey: decodeBase64ToUint8Array(partKeyInputs.votingKey),
          stateProofKey: decodeBase64ToUint8Array(partKeyInputs.stateProofKey),
        };

        await goOnline(
          BigInt(validatorAppId),
          partKey.votingKey,
          partKey.selectionKey,
          partKey.stateProofKey,
          partKey.firstRound,
          partKey.lastRound,
          partKey.keyDilution
        );
        break;
      }
      case 'goOffline': {
        const { confirm } = await confirmation();
        if (!confirm) {
          console.log('Aborted!');
          break;
        }
        const app = await getAppID(VALIDATOR, admin, validator);
        await goOffline(BigInt(app));
        break;
      }
      case 'claimDustAlgos': {
        const { confirm } = await confirmation();
        if (!confirm) {
          console.log('Aborted!');
          break;
        }
        const app = await getAppID(VALIDATOR, admin, validator);
        await claimDust(BigInt(app));
        break;
      }
      case 'migratePool': {
        const { confirm } = await confirmation();
        if (!confirm) {
          console.log('Aborted!');
          break;
        }
        const oldValidator = await getAppID(VALIDATOR, admin, validator);
        const newValidator = await getAppID(VALIDATOR, admin, validator);
        await migrate(BigInt(oldValidator), BigInt(newValidator));
        break;
      }
      case 'initRunner': {
        const app = await getAppID(ADMIN, admin, validator);
        const validatorAppId = await getAppID(VALIDATOR, admin, validator);
        const block = await inquirer.prompt([
          {
            type: 'input',
            name: 'block',
            message: 'Enter the block number to start the runner script from:',
            validate: (input) => !Number.isNaN(Number(input)) || 'Must be a valid number',
          },
        ]);
        const blockNumber = BigInt(block.block);
        await runner(BigInt(app), BigInt(validatorAppId), blockNumber);
        break;
      }
      case 'settings': {
        const { choice } = await inquirer.prompt([
          {
            type: 'list',
            name: 'choice',
            message: 'What do you want to do?',
            choices: [
              { name: 'Set Default Admin', value: 'setAdmin' },
              { name: 'Set Default Validator', value: 'setValidator' },
              { name: 'Exit', value: 'exit' },
            ],
          },
        ]);
        switch (choice) {
          case 'setAdmin': {
            const app = await inquirer.prompt([
              {
                type: 'input',
                name: 'adminAppId',
                message: 'Enter Admin App ID',
                validate: (input) => !Number.isNaN(Number(input)) || 'Must be a valid number',
              },
            ]);
            admin = BigInt(app.adminAppId);
            break;
          }
          case 'setValidator': {
            const app = await inquirer.prompt([
              {
                type: 'input',
                name: 'validatorAppId',
                message: 'Enter Validator App ID',
                validate: (input) => !Number.isNaN(Number(input)) || 'Must be a valid number',
              },
            ]);
            validator = BigInt(app.validatorAppId);
            break;
          }
          default:
            console.log('Exited!');
            break;
        }
        break;
      }
      case 'exit':
      default:
        console.log('Exited!');
        break;
    }
  }
}

function decodeBase64ToUint8Array(base64: string): Uint8Array {
  const binary = Buffer.from(base64, 'base64');
  return new Uint8Array(binary);
}

async function getAmount(): Promise<number> {
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

const confirmation = () => {
  return inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Are you sure?',
      default: false,
    },
  ]);
};

async function getAppID(role: string, defaultAdmin: bigint, defaultValidator: bigint): Promise<bigint> {
  let requestApp: bigint;
  if (defaultAdmin !== 0n && role === ADMIN) {
    return defaultAdmin;
  }
  if (defaultValidator !== 0n && role === VALIDATOR) {
    return defaultValidator;
  }
  const { choice } = await inquirer.prompt([
    {
      type: 'list',
      name: 'choice',
      message: `Do you want to use the ${role} app ID from the config file or enter it manually? \t found: ${role === ADMIN ? ADMIN_APP_ID : VALIDATOR_APP_ID}`,
      choices: [
        { name: `Use ${role === ADMIN ? ADMIN_APP_ID : VALIDATOR_APP_ID}`, value: 'config' },
        { name: 'Enter manually', value: 'manual' },
      ],
    },
  ]);
  switch (choice) {
    case 'config': {
      const appId = role === ADMIN ? ADMIN_APP_ID : VALIDATOR_APP_ID;
      if (!appId) {
        throw new Error(`No ${role} app ID found in config file`);
      }
      requestApp = BigInt(appId);
      break;
    }
    case 'manual': {
      const { appId } = await inquirer.prompt([
        {
          type: 'input',
          name: 'appId',
          message: `Enter ${role} app ID`,
          validate: (input) => !Number.isNaN(Number(input)) || 'Must be a valid number',
        },
      ]);
      requestApp = BigInt(appId);
      break;
    }
    default:
      throw new Error('Invalid choice');
  }
  return requestApp;
}

main();
