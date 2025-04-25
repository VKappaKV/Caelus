/* eslint-disable import/no-cycle */
/* eslint-disable no-console */
import { Config } from '@algorandfoundation/algokit-utils';
import * as dotenv from 'dotenv';
import { adminSetup, deploy, validatorSetup, update } from './helpers/bootstrap';
import { mint, mintOperatorCommit, addValidator } from './helpers/admin';
import { validatorOptIntoLST, deleteApp, goOnline } from './helpers/validator';
import { runner } from './runner';
import { getPartKey } from './helpers/partkey';
import { algorand } from './helpers/network';
import { updateEnvVariable } from './envManager';

dotenv.config();

const { ADMIN_APP_ID, VALIDATOR_APP_ID, MNEMONIC } = process.env;

if (!ADMIN_APP_ID || !VALIDATOR_APP_ID || !MNEMONIC) {
  throw new Error('apps or mnemonics are missing in .env');
}

export const getAccount = async () => {
  const testAccount = algorand.account.fromMnemonic(MNEMONIC);

  const random = algorand.account.random();

  return { testAccount, random };
};

const adminAppId = BigInt(ADMIN_APP_ID);
const validatorAppId = BigInt(VALIDATOR_APP_ID);

Config.configure({
  debug: true,
  traceAll: true,
});
(async () => {
  switch (process.argv[2]) {
    case 'bootstrap': {
      const app = await deploy();
      updateEnvVariable('ADMIN_APP_ID', app.toString());
      await adminSetup(app);
      await new Promise((f) => {
        setTimeout(f, 1000);
      });
      await validatorSetup(app);
      // after this change ADMIN APP ID with new instance
      break;
    }
    case 'deploy':
      console.log(`EXECUTING DEPLOY...`);
      deploy();
      break;
    case 'update':
      console.log(`EXECUTING UPDATE...`);
      update(adminAppId);
      break;
    case 'admin':
      console.log(`EXECUTING ADMIN SET UP...`);
      adminSetup(adminAppId);
      break;
    case 'validator':
      console.log(`EXECUTING VALIDATOR SET UP...`);
      validatorSetup(adminAppId);
      break;
    case 'spawn':
      console.log(`EXECUTING SPAWN...`);
      addValidator(adminAppId);
      break;
    case 'test':
      console.log('EXECUTING MINT');
      mint(adminAppId);
      break;
    case 'mintOperator':
      console.log('EXECUTING OPERATOR MINT');
      mintOperatorCommit(adminAppId, validatorAppId);
      break;
    case 'poolOptIn':
      console.log('EXECUTING VALIDATOR POOL OPT IN');
      validatorOptIntoLST(validatorAppId);
      break;
    case 'goOnline': {
      console.log('EXECUTING GO ONLINE');
      const partKey = getPartKey();
      goOnline(
        validatorAppId,
        partKey.votingKey,
        partKey.selectionKey,
        partKey.stateProofKey,
        partKey.firstRound,
        partKey.lastRound,
        partKey.keyDilution
      );
      break;
    }
    case 'delete':
      console.log('EXECUTING VALIDATOR POOL DELETE');
      deleteApp(validatorAppId);
      break;
    case 'runner':
      console.log('EXECUTING RUNNER');
      runner(adminAppId, BigInt(process.argv[3]), BigInt(process.argv[4]));
      break;
    default:
      console.log('DEFAULT, WHAT?');
  }
})();
