import * as algokit from '@algorandfoundation/algokit-utils';
import { algorand } from './network';
import { getAccount } from './bootstrap';
import { CaelusAdminClient } from '../contracts/clients/CaelusAdminClient';

export async function mint(adminAppId: bigint) {
  const { testAccount } = await getAccount();
  const client = algorand.client.getTypedAppClientById(CaelusAdminClient, {
    appId: adminAppId,
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });
  const pay = await algorand.createTransaction.payment({
    sender: testAccount.addr,
    receiver: client.appAddress,
    amount: (100).algos(),
  });

  const mintTxn = await client.send.mintRequest({
    args: [pay],
    populateAppCallResources: true,
    extraFee: (2000).microAlgos(),
  });

  console.log(`Minted: ${mintTxn.txIds}`);
}

export async function mintOperatorCommit(admin: bigint, pool: bigint) {
  const { testAccount } = await getAccount();

  const client = algorand.client.getTypedAppClientById(CaelusAdminClient, {
    appId: admin,
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });
  const pay = await algorand.createTransaction.payment({
    sender: testAccount.addr,
    receiver: client.appAddress,
    amount: (100_000).algos(),
  });

  const mintTxn = await client.send.mintValidatorCommit({
    args: [pool, pay],
    populateAppCallResources: true,
    extraFee: (4000).microAlgos(),
  });

  console.log(`Minted operator commit to pool ${pool}, txn: ${mintTxn.groupId}`);
}

export async function burn(adminAppId: bigint, amount: bigint) {
  const { testAccount } = await getAccount();
  const client = algorand.client.getTypedAppClientById(CaelusAdminClient, {
    appId: adminAppId,
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });
  const asset = await client.state.global.tokenId();
  if (!asset) {
    throw new Error('No asset found');
  }
  const axfer = await algorand.createTransaction.assetTransfer({
    sender: testAccount.addr,
    receiver: client.appAddress,
    assetId: asset,
    amount,
    signer: testAccount.signer,
  });

  const burnTxn = await client.send.burnRequest({
    args: [axfer, testAccount.addr.toString()],
    populateAppCallResources: true,
    extraFee: (5000).microAlgos(),
  });
  console.log(`Burned: ${burnTxn.txIds}`);
}

export async function removeOperatorCommit(pool: bigint, adminAppId: bigint, amount: bigint) {
  const { testAccount } = await getAccount();
  const client = algorand.client.getTypedAppClientById(CaelusAdminClient, {
    appId: adminAppId,
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });

  const burnTxn = await client.send.removeValidatorCommit({
    args: [pool, amount],
    populateAppCallResources: true,
    extraFee: (2000).microAlgos(),
  });
  console.log(`Removed operator commit from pool ${pool}, txn: ${burnTxn.txIds}`);
}
