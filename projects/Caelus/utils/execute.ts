/* eslint-disable no-console */
import { Config } from '@algorandfoundation/algokit-utils';
import { addValidator, adminSetup, deploy, validatorSetup, update } from './bootstrap';
import { deleteApp, mint, mintOperatorCommit, validatorOptIntoLST } from './helpers';
import { runner } from './runner';

const ADMIN_APP_ID = 16328303n;
const VALIDATOR_APP_ID = 16328320n;

Config.configure({
  debug: true,
  traceAll: true,
});
(async () => {
  switch (process.argv[2]) {
    case 'bootstrap': {
      const app = await deploy();
      await adminSetup(app);
      await new Promise((f) => {
        setTimeout(f, 1000);
      });
      await validatorSetup(app);
      await new Promise((f) => {
        setTimeout(f, 1000);
      });
      await addValidator(app);
      break;
    }
    case 'deploy':
      console.log(`EXECUTING DEPLOY...`);
      deploy();
      break;
    case 'update':
      console.log(`EXECUTING UPDATE...`);
      update(ADMIN_APP_ID);
      break;
    case 'admin':
      console.log(`EXECUTING ADMIN SET UP...`);
      adminSetup(ADMIN_APP_ID);
      break;
    case 'validator':
      console.log(`EXECUTING VALIDATOR SET UP...`);
      validatorSetup(ADMIN_APP_ID);
      break;
    case 'spawn':
      console.log(`EXECUTING SPAWN...`);
      addValidator(ADMIN_APP_ID);
      break;
    case 'test':
      console.log('EXECUTING MINT');
      mint(ADMIN_APP_ID);
      break;
    case 'mintOperator':
      console.log('EXECUTING OPERATOR MINT');
      mintOperatorCommit(ADMIN_APP_ID, VALIDATOR_APP_ID);
      break;
    case 'poolOptIn':
      console.log('EXECUTING VALIDATOR POOL OPT IN');
      validatorOptIntoLST(VALIDATOR_APP_ID);
      break;
    case 'delete':
      console.log('EXECUTING VALIDATOR POOL DELETE');
      deleteApp(VALIDATOR_APP_ID);
      break;
    case 'runner':
      console.log('EXECUTING RUNNER');
      runner(ADMIN_APP_ID, BigInt(process.argv[3]), BigInt(process.argv[4]));
      break;
    default:
      console.log('DEFAULT, WHAT?');
  }
})();
