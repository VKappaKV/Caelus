/* eslint-disable no-console */
import { Config } from '@algorandfoundation/algokit-utils';
import { addValidator, adminSetup, deploy, validatorSetup, test, update } from './bootstrap';
import { deleteApp, mintOperatorCommit, validatorOptIntoLST } from './helpers';

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
      update(1002n);
      break;
    case 'admin':
      console.log(`EXECUTING ADMIN SET UP...`);
      adminSetup(1002n);
      break;
    case 'validator':
      console.log(`EXECUTING VALIDATOR SET UP...`);
      validatorSetup(1002n);
      break;
    case 'spawn':
      console.log(`EXECUTING SPAWN...`);
      addValidator(1002n);
      break;
    case 'spam':
      console.log('EXECUTING SPAM');
      test();
      break;
    case 'mintOperator':
      console.log('EXECUTING OPERATOR MINT');
      mintOperatorCommit(1002n, 1015n);
      break;
    case 'poolOptIn':
      console.log('EXECUTING VALIDATOR POOL OPT IN');
      validatorOptIntoLST(1015n);
      break;
    case 'delete':
      console.log('EXECUTING VALIDATOR POOL DELETE');
      deleteApp(1015n);
      break;
    default:
      console.log('DEFAULT, WHAT?');
  }
})();
