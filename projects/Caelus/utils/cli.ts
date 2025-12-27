/* eslint-disable import/no-cycle */
/* eslint-disable no-await-in-loop */
/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable no-use-before-define */
/* eslint-disable no-console */
import inquirer from 'inquirer';
import { Config } from '@algorandfoundation/algokit-utils';
import chalk from 'chalk';
import { deploy, update } from './helpers/deploy';
import { runner } from './runner';
import { getAccount, VALIDATOR_APP_ID } from './account';
import { mint, spawn, burn, bid, commit, retract, delegate } from './helpers/appCalls';
import { EquilibriumClient } from '../contracts/clients/EquilibriumClient';
import { Account } from './types/account';
import { algorand } from './network';

Config.configure({
  debug: true,
  traceAll: true,
});

const VALIDATOR = 'VALIDATOR';

export async function clientSetUp(appId: bigint, account: Account) {
  return algorand.client.getTypedAppClientById(EquilibriumClient, {
    appId,
    defaultSender: account.addr,
    defaultSigner: account.signer,
  });
}

async function main() {
  let validator: string = '';
  let action: string = '';
  let appId: bigint = 0n;
  const { testAccount } = await getAccount();
  let client: EquilibriumClient | null = null;

  while (action !== 'exit') {
    const pick = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: chalk.blue('\n What do you want to execute?'),
        choices: [
          { name: 'Deploy', value: 'deploy' },
          { name: 'Spawn Validator', value: 'spawn' },
          { name: 'Update', value: 'update' },
          { name: 'Mint', value: 'mint' },
          { name: 'Mint (Operator Commit)', value: 'mintOperator' },
          { name: 'Burn', value: 'burn' },
          { name: 'Remove Operator Commit', value: 'burnOperator' },
          { name: 'Bid Validator', value: 'bidValidator' },
          { name: 'Delegate stake to validator', value: 'delegate' },
          { name: 'Delete Operator', value: 'deleteOperator' },
          { name: 'Claim Leftover Algos into the Validator', value: 'claimDustAlgos' },
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
      case 'deploy': {
        const { confirm } = await confirmation();
        if (!confirm) {
          console.log('Aborted!');
          break;
        }
        appId = (await deploy(testAccount)).id;
        client = await clientSetUp(appId, testAccount);
        break;
      }
      case 'spawn': {
        const { confirm } = await confirmation();
        if (!confirm) {
          console.log('Aborted!');
          break;
        }
        if (!client) {
          console.log('Client not set up. Please deploy first...Or check something else is wrong');
          break;
        }
        await spawn(testAccount, client);
        break;
      }
      case 'update': {
        const { confirm } = await confirmation();
        if (!confirm) {
          console.log('Aborted!');
          break;
        }
        if (!client) {
          console.log('Client not set up. Please deploy first...Or check something else is wrong');
          break;
        }
        const app = client.appId;
        await update(app, testAccount);
        break;
      }
      case 'mint': {
        const amount = await getAmount();
        if (!client) {
          console.log('Client not set up. Please deploy first...Or check something else is wrong');
          break;
        }
        await mint(amount, testAccount, client);
        break;
      }
      case 'burn': {
        const amount = await getAmount();
        if (!client) {
          console.log('Client not set up. Please deploy first...Or check something else is wrong');
          break;
        }
        await burn(BigInt(amount), testAccount, client);
        break;
      }
      case 'mintOperator': {
        const amount = await getAmount();
        if (!client) {
          console.log('Client not set up. Please deploy first...Or check something else is wrong');
          break;
        }
        await commit(testAccount, client, amount);
        break;
      }
      case 'burnOperator': {
        const amount = await getAmount();
        if (!client) {
          console.log('Client not set up. Please deploy first...Or check something else is wrong');
          break;
        }
        await retract(testAccount, client, BigInt(amount));
        break;
      }
      case 'bidValidator': {
        const validatorToBid = await getAddress();
        if (!client) {
          console.log('Client not set up. Please deploy first...Or check something else is wrong');
          break;
        }
        await bid(validatorToBid, client);
        break;
      }
      case 'delegate': {
        const amount = await getAmount();
        if (!client) {
          console.log('Client not set up. Please deploy first...Or check something else is wrong');
          break;
        }
        await delegate(amount, client);
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
              { name: 'Set Default Main', value: 'setMain' },
              { name: 'Set Default Validator', value: 'setValidator' },
              { name: 'Exit', value: 'exit' },
            ],
          },
        ]);
        switch (choice) {
          case 'setMain': {
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

async function getAddress(): Promise<string> {
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

main();
