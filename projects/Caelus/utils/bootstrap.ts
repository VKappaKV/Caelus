/* eslint-disable prettier/prettier */
/* eslint-disable no-use-before-define */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-plusplus */
/* eslint-disable no-console */
import * as algokit from '@algorandfoundation/algokit-utils';
import { consoleLogger } from '@algorandfoundation/algokit-utils/types/logging';
import { Config } from '@algorandfoundation/algokit-utils';
import { OnSchemaBreak, OnUpdate } from '@algorandfoundation/algokit-utils/types/app';
import { CaelusAdminClient, CaelusAdminFactory } from '../contracts/clients/CaelusAdminClient';
import { CaelusValidatorPoolFactory } from '../contracts/clients/CaelusValidatorPoolClient';

Config.configure({
  debug: true,
  traceAll: true,
});

/**
 *
 *
 *
 *
 */

/* const ALGOD_ENDPOINT = 'https://fnet-api.4160.nodely.dev';
const ALGOD_TOKEN = '';
const ALGOD_PORT = 443

const algorand = algokit.AlgorandClient.fromConfig({
  algodConfig: {
    server: ALGOD_ENDPOINT,
    token: ALGOD_TOKEN,
    port: ALGOD_PORT,
  },
}); */

const algorand = algokit.AlgorandClient.fromConfig({
  algodConfig: {
    server: 'http://localhost',
    token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    port: 4001,
  },
  indexerConfig: {
    server: 'http://localhost',
    token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    port: 8980,
  },
});

const APP_ID = 1411n;

export const test = async () => {
  const testAccount = await algorand.account.fromKmd(
    'lora-dev',
    (account) => account.address === 'W6RAW7BEU6JGZU5X5QH4JGHAA27YBT6BRWZW5HTB7WGTZZNNBWM6SHGNDI'
  );
  const validatorTest = await algorand.account.fromKmd(
    'lora-dev',
    (account) => account.address === 'XVHVTMT7YQJSTPAH42DNYDOSL23R42QQ7OAUTFNHFMXUKWDVU4KZ3UNDTM'
  );

  for (let i = 0; i < 320; i++) {
    await new Promise((f) => {
      setTimeout(f, 3000);
    });

    const pay = await algorand.send.payment({
      sender: testAccount.addr,
      signer: testAccount,
      receiver: validatorTest.addr,
      amount: algokit.microAlgos(1000000),
    });

    console.log('CONFIRMATION OF TEST IS : ', pay.txIds);
  }
};

export async function deploy() {
  /**
   * to fix, how to properly deploy with AlgoKit Utils?
   */

  const testAccount = await algorand.account.fromKmd(
    'lora-dev',
    (account) => account.address === 'W6RAW7BEU6JGZU5X5QH4JGHAA27YBT6BRWZW5HTB7WGTZZNNBWM6SHGNDI'
  );

  const adminFactory = algorand.client.getTypedAppFactory(CaelusAdminFactory, {
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });

  const adminApprovalProgram = await adminFactory.appFactory.compile();

  const appDeployer = await algorand.appDeployer.deploy({
    metadata: {
      name: 'Caelus',
      version: '1.0.0',
      deletable: false,
      updatable: true,
    },
    createParams: {
      sender: testAccount.addr,
      approvalProgram: adminApprovalProgram.compiledApproval?.compiledBase64ToBytes!,
      clearStateProgram: adminApprovalProgram.compiledClear?.compiledBase64ToBytes!,
      schema: {
        globalInts: 13,
        globalByteSlices: 2,
        localInts: 0,
        localByteSlices: 0,
      },
      extraProgramPages: 3,
    },
    updateParams: { sender: testAccount.addr },
    deleteParams: { sender: testAccount.addr },
    onSchemaBreak: OnSchemaBreak.AppendApp,
    onUpdate: OnUpdate.UpdateApp,
    populateAppCallResources: true,
  });

  console.log('APP ID IS: ', appDeployer.appId);
  console.log('APP ADDRESS IS: ', appDeployer.appAddress);
}

export async function updateAdmin() {
  const testAccount = await algorand.account.fromKmd(
    'lora-dev',
    (account) => account.address === 'W6RAW7BEU6JGZU5X5QH4JGHAA27YBT6BRWZW5HTB7WGTZZNNBWM6SHGNDI'
  );

  const adminClient = algorand.client.getTypedAppClientById(CaelusAdminClient, {
    appId: APP_ID,
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });

  // await adminClient.send.update({});
}

export async function adminSetup() {
  const testAccount = await algorand.account.fromKmd(
    'lora-dev',
    (account) => account.address === 'W6RAW7BEU6JGZU5X5QH4JGHAA27YBT6BRWZW5HTB7WGTZZNNBWM6SHGNDI'
  );

  const adminClient = algorand.client.getTypedAppClientById(CaelusAdminClient, {
    appId: APP_ID,
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });

  await algorand.send.payment({
    sender: testAccount.addr,
    signer: testAccount,
    receiver: adminClient.appAddress,
    amount: algokit.microAlgos(1000000),
  });

  await adminClient.send.managerCreateToken({ args: [], extraFee: algokit.microAlgos(1000) });
}

export async function validatorSetup() {
  const testAccount = await algorand.account.fromKmd(
    'lora-dev',
    (account) => account.address === 'W6RAW7BEU6JGZU5X5QH4JGHAA27YBT6BRWZW5HTB7WGTZZNNBWM6SHGNDI'
  );
  const adminClient = algorand.client.getTypedAppClientById(CaelusAdminClient, {
    appId: APP_ID,
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });

  const validatorFactory = algorand.client.getTypedAppFactory(CaelusValidatorPoolFactory, {
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });

  const validatorPoolApprovalProgram = await validatorFactory.appFactory.compile();

  await algorand.send.payment({
    sender: testAccount.addr,
    signer: testAccount,
    receiver: adminClient.appAddress,
    amount: algokit.microAlgos(1000000),
  });

  await updatePoolProgram(adminClient, validatorPoolApprovalProgram.compiledApproval?.compiledBase64ToBytes!);
  await writePoolProgram(adminClient, validatorPoolApprovalProgram.compiledApproval?.compiledBase64ToBytes!);
}

export async function addValidator() {
  const testAccount = await algorand.account.fromKmd(
    'lora-dev',
    (account) => account.address === 'W6RAW7BEU6JGZU5X5QH4JGHAA27YBT6BRWZW5HTB7WGTZZNNBWM6SHGNDI'
  );

  const adminClient = algorand.client.getTypedAppClientById(CaelusAdminClient, {
    appId: APP_ID,
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });
  const group = adminClient.newGroup();

  const pay = await algorand.createTransaction.payment({
    sender: testAccount.addr,
    receiver: adminClient.appAddress,
    amount: algokit.microAlgos(1020500),
  });
  group.addValidator({ args: [pay] });
}

export async function updatePoolProgram(adminFactory: CaelusAdminClient, program: Uint8Array) {
  const resultTxn = await adminFactory.send.managerUpdatePoolContractProgram({
    args: { programSize: program.length },
    populateAppCallResources: true,
  });

  consoleLogger.info(`program size for validator pool contract: ${program.length}`);

  consoleLogger.info(`${program}`);

  console.log('here is the result of MAIN TESTING: ', resultTxn.groupId, 'with TxIDs: ', resultTxn.txIds);
}

export async function writePoolProgram(adminFactory: CaelusAdminClient, program: Uint8Array) {
  const writeGroup = adminFactory.newGroup();

  for (let i = 0; i < program.length; i += 2000) {
    writeGroup.managerWritePoolContractProgram({
      args: {
        offset: i,
        data: program.subarray(i, i + 2000),
      },
    });
  }

  writeGroup.send({ populateAppCallResources: true });
}
