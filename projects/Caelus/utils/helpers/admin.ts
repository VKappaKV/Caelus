/* eslint-disable import/no-cycle */
/* eslint-disable no-console */
import * as algokit from '@algorandfoundation/algokit-utils';
import { algorand } from '../network';
import { getAccount } from '../account';
import { CaelusAdminClient } from '../../contracts/clients/CaelusAdminClient';

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

export async function mint(adminAppId: bigint, amount: number) {
  const { testAccount } = await getAccount();
  const client = algorand.client.getTypedAppClientById(CaelusAdminClient, {
    appId: adminAppId,
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });
  const pay = await algorand.createTransaction.payment({
    sender: testAccount.addr,
    receiver: client.appAddress,
    amount: amount.algos(),
  });

  const mintTxn = await client.send.mintRequest({
    args: [pay],
    populateAppCallResources: true,
    extraFee: (2000).microAlgos(),
  });

  console.log(`Minted: ${mintTxn.txIds}`);
}

export async function mintOperatorCommit(admin: bigint, pool: bigint, amount: number) {
  const { testAccount } = await getAccount();

  const client = algorand.client.getTypedAppClientById(CaelusAdminClient, {
    appId: admin,
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });
  const pay = await algorand.createTransaction.payment({
    sender: testAccount.addr,
    receiver: client.appAddress,
    amount: amount.algos(),
  });

  const mintTxn = await client.send.mintValidatorCommit({
    args: [pool, pay],
    populateAppCallResources: true,
    extraFee: (4000).microAlgos(),
  });

  console.log(`Minted operator commit to pool ${pool}, txn: ${mintTxn.groupId}`);
}

export async function delegate(adminAppId: bigint, amount: number) {
  const { testAccount } = await getAccount();
  const client = algorand.client.getTypedAppClientById(CaelusAdminClient, {
    appId: adminAppId,
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });

  const delegateTxn = await client.send.delegateStake({
    args: [amount],
    populateAppCallResources: true,
    extraFee: (2000).microAlgos(),
  });
  console.log(`Delegated: ${delegateTxn.txIds}`);
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

export async function removeOperatorCommit(pool: bigint, adminAppId: bigint, amount: number) {
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

export async function bid(adminAppId: bigint, poolAppId: bigint) {
  const { testAccount } = await getAccount();
  const client = algorand.client.getTypedAppClientById(CaelusAdminClient, {
    appId: adminAppId,
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });

  const bidTxn = await client.send.bid({
    args: [poolAppId],
    populateAppCallResources: true,
  });
  console.log(`Bid to pool ${poolAppId}, txn: ${bidTxn.txIds}`);
}

export async function snitch(adminAppId: bigint, poolAppId: bigint) {
  const { testAccount } = await getAccount();
  const client = algorand.client.getTypedAppClientById(CaelusAdminClient, {
    appId: adminAppId,
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });

  const snitchTxn = await client.send.snitchToBurn({
    args: [poolAppId],
    populateAppCallResources: true,
  });
  console.log(`Snitched on pool ${poolAppId}, txn: ${snitchTxn.txIds}`);
}
