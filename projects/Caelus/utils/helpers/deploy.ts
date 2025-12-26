import { Config } from '@algorandfoundation/algokit-utils';
import { OnSchemaBreak, OnUpdate } from '@algorandfoundation/algokit-utils/types/app';
import algosdk, { Address } from 'algosdk';
import { algorand } from '../network';
import { EquilibriumClient, EquilibriumFactory } from '../../contracts/clients/EquilibriumClient';
import { Account } from '../types/account';

Config.configure({
  debug: true,
  traceAll: true,
});

interface DeployResult {
  id: bigint;
  address: Address;
  name: string;
}

export async function deploy(testAccount: Account): Promise<DeployResult> {
  const contractFactory = algorand.client.getTypedAppFactory(EquilibriumFactory, {
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });

  const approvalProgram = await contractFactory.appFactory.compile();

  const appDeployer = await algorand.appDeployer.deploy({
    metadata: {
      name: 'Equilibrium',
      version: '1.0.0',
      deletable: false,
      updatable: true,
    },
    createParams: {
      sender: testAccount.addr,
      approvalProgram: approvalProgram.compiledApproval?.compiledBase64ToBytes!,
      clearStateProgram: approvalProgram.compiledClear?.compiledBase64ToBytes!,
      schema: {
        globalInts: 7,
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

  return { id: appDeployer.appId, address: appDeployer.appAddress, name: appDeployer.name };
}

export async function update(APP_ID: bigint, testAccount: Account) {
  const factory = algorand.client.getTypedAppFactory(EquilibriumFactory, {
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });

  const client = algorand.client.getTypedAppClientById(EquilibriumClient, {
    appId: APP_ID,
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });

  const adminApprovalProgram = await factory.appFactory.compile();

  await algorand.send.appUpdateMethodCall({
    sender: testAccount.addr,
    signer: testAccount,
    appId: APP_ID,
    method: client.appClient.getABIMethod('updateApplication()void'),
    approvalProgram: adminApprovalProgram.compiledApproval?.compiledBase64ToBytes!,
    clearStateProgram: adminApprovalProgram.compiledClear?.compiledBase64ToBytes!,
    onComplete: algosdk.OnApplicationComplete.UpdateApplicationOC,
    populateAppCallResources: true,
  });
}
