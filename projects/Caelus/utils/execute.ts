/* eslint-disable no-console */
import { Config } from '@algorandfoundation/algokit-utils';
import { addValidator, adminSetup, deploy, validatorSetup, test, update } from './bootstrap';

Config.configure({
  debug: true,
  traceAll: true,
});

switch (process.argv[2]) {
  case 'deploy':
    console.log(`EXECUTING DEPLOY...`);
    deploy();
    break;
  case 'update':
    console.log(`EXECUTING UPDATE...`);
    update();
    break;
  case 'admin':
    console.log(`EXECUTING ADMIN SET UP...`);
    adminSetup();
    break;
  case 'validator':
    console.log(`EXECUTING VALIDATOR SET UP...`);
    validatorSetup();
    break;
  case 'spawn':
    console.log(`EXECUTING SPAWN...`);
    addValidator();
    break;
  case 'spam':
    console.log('EXECUTING SPAM');
    test();
    break;
  default:
    console.log('DEFAULT, WHAT?');
}
