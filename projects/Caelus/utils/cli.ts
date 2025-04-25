/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable no-use-before-define */
/* eslint-disable no-console */
import inquirer from 'inquirer';
import { Config } from '@algorandfoundation/algokit-utils';
import { adminSetup, deploy, validatorSetup, update } from './helpers/bootstrap';
import { mint, mintOperatorCommit, addValidator } from './helpers/admin';
import { validatorOptIntoLST, goOnline } from './helpers/validator';

Config.configure({
  debug: true,
  traceAll: true,
});

async function main() {
  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What do you want to execute?',
      choices: [
        { name: 'Bootstrap (deploy + admin + validator)', value: 'bootstrap' },
        { name: 'Deploy', value: 'deploy' },
        { name: 'Admin Setup', value: 'admin' },
        { name: 'Validator Setup', value: 'validator' },
        { name: 'Spawn Validator', value: 'spawn' },
        { name: 'Update', value: 'update' },
        { name: 'Mint', value: 'mint' },
        { name: 'Mint (Operator Commit)', value: 'mintOperator' },
        { name: 'Validator Pool Opt-In', value: 'poolOptIn' },
        { name: 'Go Online', value: 'goOnline' },
        { name: 'Exit', value: 'exit' },
      ],
    },
  ]);

  switch (action) {
    case 'bootstrap': {
      const app = await deploy();
      await adminSetup(app);

      await new Promise<void>((resolve) => {
        setTimeout(() => resolve(), 1000);
      });

      await validatorSetup(app);
      break;
    }
    case 'deploy': {
      await deploy();
      break;
    }
    case 'admin': {
      const { adminAppId } = await inquirer.prompt([
        {
          type: 'input',
          name: 'adminAppId',
          message: 'Enter Admin App ID',
          validate: (input) => !Number.isNaN(Number(input)) || 'Must be a valid number',
        },
      ]);
      await adminSetup(BigInt(adminAppId));
      break;
    }
    case 'validator': {
      const { adminAppId } = await inquirer.prompt([
        {
          type: 'input',
          name: 'adminAppId',
          message: 'Enter Admin App ID',
          validate: (input) => !Number.isNaN(Number(input)) || 'Must be a valid number',
        },
      ]);
      await validatorSetup(BigInt(adminAppId));
      break;
    }
    case 'spawn': {
      const { adminAppId } = await inquirer.prompt([
        {
          type: 'input',
          name: 'adminAppId',
          message: 'Enter Admin App ID',
          validate: (input) => !Number.isNaN(Number(input)) || 'Must be a valid number',
        },
      ]);
      await addValidator(BigInt(adminAppId));
      break;
    }
    case 'update': {
      const { adminAppId } = await inquirer.prompt([
        {
          type: 'input',
          name: 'adminAppId',
          message: 'Enter Admin App ID',
          validate: (input) => !Number.isNaN(Number(input)) || 'Must be a valid number',
        },
      ]);
      await update(BigInt(adminAppId));
      break;
    }
    case 'mint': {
      const { adminAppId } = await inquirer.prompt([
        {
          type: 'input',
          name: 'adminAppId',
          message: 'Enter Admin App ID',
          validate: (input) => !Number.isNaN(Number(input)) || 'Must be a valid number',
        },
      ]);
      await mint(BigInt(adminAppId));
      break;
    }
    case 'mintOperator': {
      const { adminAppId, validatorAppId } = await inquirer.prompt([
        {
          type: 'input',
          name: 'adminAppId',
          message: 'Enter Admin App ID',
          validate: (input) => !Number.isNaN(Number(input)) || 'Must be a valid number',
        },
        {
          type: 'input',
          name: 'validatorAppId',
          message: 'Enter Validator App ID',
          validate: (input) => !Number.isNaN(Number(input)) || 'Must be a valid number',
        },
      ]);
      await mintOperatorCommit(BigInt(adminAppId), BigInt(validatorAppId));
      break;
    }
    case 'poolOptIn': {
      const { validatorAppId } = await inquirer.prompt([
        {
          type: 'input',
          name: 'validatorAppId',
          message: 'Enter Validator App ID',
          validate: (input) => !Number.isNaN(Number(input)) || 'Must be a valid number',
        },
      ]);
      await validatorOptIntoLST(BigInt(validatorAppId));
      break;
    }
    case 'goOnline': {
      const { validatorAppId } = await inquirer.prompt([
        {
          type: 'input',
          name: 'validatorAppId',
          message: 'Enter Validator App ID',
          validate: (input) => !Number.isNaN(Number(input)) || 'Must be a valid number',
        },
      ]);

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
    case 'exit':
    default:
      console.log('Exited!');
      break;
  }
}

function decodeBase64ToUint8Array(base64: string): Uint8Array {
  const binary = Buffer.from(base64, 'base64');
  return new Uint8Array(binary);
}

main();
