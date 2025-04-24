/* eslint-disable no-await-in-loop */
/* eslint-disable no-console */
import * as algokit from '@algorandfoundation/algokit-utils';
import { consoleLogger } from '@algorandfoundation/algokit-utils/types/logging';
import { Config } from '@algorandfoundation/algokit-utils';
import { OnSchemaBreak, OnUpdate } from '@algorandfoundation/algokit-utils/types/app';
import algosdk from 'algosdk';
import { CaelusAdminClient, CaelusAdminFactory } from '../contracts/clients/CaelusAdminClient';
import { CaelusValidatorPoolFactory } from '../contracts/clients/CaelusValidatorPoolClient';
import { MNEMONIC } from '../env';
import { algorand } from './network';

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

export const getAccount = async () => {
  const testAccount = algorand.account.fromMnemonic(MNEMONIC);

  const random = algorand.account.random();

  return { testAccount, random };
};
export async function deploy(): Promise<bigint> {
  // change with other wallet depending on your network
  const { testAccount } = await getAccount();

  const adminFactory = algorand.client.getTypedAppFactory(CaelusAdminFactory, {
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });

  const adminApprovalProgram = await adminFactory.appFactory.compile();

  const appDeployer = await algorand.appDeployer.deploy({
    metadata: {
      name: 'Vestguard',
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
        globalByteSlices: 3,
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

  return appDeployer.appId;
}

export async function update(APP_ID: bigint) {
  const { testAccount } = await getAccount();

  const adminFactory = algorand.client.getTypedAppFactory(CaelusAdminFactory, {
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });

  const adminClient = algorand.client.getTypedAppClientById(CaelusAdminClient, {
    appId: APP_ID,
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });

  const adminApprovalProgram = await adminFactory.appFactory.compile();

  await algorand.send.appUpdateMethodCall({
    sender: testAccount.addr,
    signer: testAccount,
    appId: APP_ID,
    method: adminClient.appClient.getABIMethod('updateApplication()void'),
    approvalProgram: adminApprovalProgram.compiledApproval?.compiledBase64ToBytes!,
    clearStateProgram: adminApprovalProgram.compiledClear?.compiledBase64ToBytes!,
    onComplete: algosdk.OnApplicationComplete.UpdateApplicationOC,
    populateAppCallResources: true,
  });
}

export async function adminSetup(APP_ID: bigint) {
  const { testAccount } = await getAccount();

  const adminClient = algorand.client.getTypedAppClientById(CaelusAdminClient, {
    appId: APP_ID,
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });

  await algorand.send.payment({
    sender: testAccount.addr,
    signer: testAccount,
    receiver: adminClient.appAddress,
    amount: (1_000_000).microAlgo(),
  });

  await adminClient.send.managerCreateToken({ args: [], extraFee: algokit.microAlgos(1000) });

  const dummyIDtxn = await algorand.send.assetCreate({
    sender: testAccount.addr,
    signer: testAccount,
    assetName: 'dummy',
    unitName: 'DUM',
    total: 10_000_000_000_000_000n,
    decimals: 6,
  });

  await adminClient.send.managerUpdateBoostTokenId({
    args: [dummyIDtxn.assetId],
    extraFee: algokit.microAlgos(1000),
    populateAppCallResources: true,
  });
}

export async function addValidator(APP_ID: bigint) {
  const { testAccount } = await getAccount();

  const adminClient = algorand.client.getTypedAppClientById(CaelusAdminClient, {
    appId: APP_ID,
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });
  const group = adminClient.newGroup();

  const pay = await algorand.createTransaction.payment({
    sender: testAccount.addr,
    receiver: adminClient.appAddress,
    amount: (1120500).microAlgo(),
  });
  group.addValidator({ args: [pay], extraFee: algokit.microAlgos(1000) });

  group.send({ populateAppCallResources: true });
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

export async function validatorSetup(APP_ID: bigint) {
  const { testAccount } = await getAccount();
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
    amount: (1000000).microAlgo(),
  });

  await updatePoolProgram(adminClient, validatorPoolApprovalProgram.compiledApproval?.compiledBase64ToBytes!);
  await writePoolProgram(adminClient, validatorPoolApprovalProgram.compiledApproval?.compiledBase64ToBytes!);
}
