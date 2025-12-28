import inquirer from 'inquirer';
import { Config } from '@algorandfoundation/algokit-utils';
import chalk from 'chalk';
import { deploy, update } from './helpers/deploy';
import { getAccount } from './helpers/account';
import { mint, spawn, burn, bid, commit, retract, delegate, online, offline } from './helpers/appCalls';
import { EquilibriumClient } from '../contracts/clients/EquilibriumClient';
import { Account } from './types/account';
import { algorand } from './helpers/network';
import { confirmation, decodeBase64ToUint8Array, getAddress, getAmount } from './helpers/misc';

Config.configure({
  debug: true,
  traceAll: true,
});

export async function clientSetUp(appId: bigint, account: Account) {
  return algorand.client.getTypedAppClientById(EquilibriumClient, {
    appId,
    defaultSender: account.addr,
    defaultSigner: account.signer,
  });
}

async function main() {
  const validators: string[] = [];
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
        const partKeyInputs = await inquirer.prompt([
          {
            type: 'input',
            name: 'firstRound',
            message: 'First round:',
            validate: (input: string) => !Number.isNaN(Number(input)) || 'Must be a valid number',
          },
          {
            type: 'input',
            name: 'lastRound',
            message: 'Last round:',
            validate: (input: string) => !Number.isNaN(Number(input)) || 'Must be a valid number',
          },
          {
            type: 'input',
            name: 'keyDilution',
            message: 'Key dilution:',
            validate: (input: string) => !Number.isNaN(Number(input)) || 'Must be a valid number',
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

        if (!client) {
          console.log('Client not set up. Please deploy first...Or check something else is wrong');
          break;
        }

        await online(testAccount, client, partKey);
        break;
      }
      case 'goOffline': {
        const { confirm } = await confirmation();
        if (!confirm) {
          console.log('Aborted!');
          break;
        }
        if (!client) {
          console.log('Client not set up. Please deploy first...Or check something else is wrong');
          break;
        }
        await offline(testAccount, client);
        break;
      }
      case 'initRunner': {
        const block = await inquirer.prompt([
          {
            type: 'input',
            name: 'block',
            message: 'Enter the block number to start the runner script from:',
            validate: (input: string) => !Number.isNaN(Number(input)) || 'Must be a valid number',
          },
        ]);
        const blockNumber = BigInt(block.block);
        console.log(`Runner script initialized from block number: ${blockNumber}`);
        // await runner(appId, blockNumber, testAccount);
        break;
      }
      case 'settings': {
        const { choice } = await inquirer.prompt([
          {
            type: 'list',
            name: 'choice',
            message: 'What do you want to do?',
            choices: [
              { name: 'Set Default App', value: 'setMain' },
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
                validate: (input: string) => !Number.isNaN(Number(input)) || 'Must be a valid number',
              },
            ]);
            appId = BigInt(app.adminAppId);
            break;
          }
          case 'setValidator': {
            const app = await inquirer.prompt([
              {
                type: 'input',
                name: 'validatorAppId',
                message: `Enter Validator Address to add to the default list: \n ${validators.join(', ')}`,
              },
            ]);
            validators.push(app.validatorAppId);
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

main();
