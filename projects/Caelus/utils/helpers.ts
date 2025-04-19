/* eslint-disable no-console */
import algosdk from 'algosdk';
import { CaelusAdminClient } from '../contracts/clients/CaelusAdminClient';
import { CaelusValidatorPoolClient } from '../contracts/clients/CaelusValidatorPoolClient';
import { getAccount } from './bootstrap';
import { algorand } from './network';

// ADMIN METHODS

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

// VALIDATOR METHODS

export async function validatorOptIntoLST(poolApp: bigint) {
  const { testAccount } = await getAccount();
  const client = algorand.client.getTypedAppClientById(CaelusValidatorPoolClient, {
    appId: poolApp,
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });
  await algorand.send.payment({
    sender: testAccount.addr,
    receiver: client.appAddress,
    amount: (0.2).algos(),
  });
  const tx = await client.send.optIntoLst({ args: [], extraFee: (1000).microAlgos(), populateAppCallResources: true });
  console.log(`Opted into LST: ${tx.txIds}`);
}

export async function reportRewards(poolApp: bigint, block: bigint) {
  const { testAccount } = await getAccount();
  const client = algorand.client.getTypedAppClientById(CaelusValidatorPoolClient, {
    appId: poolApp,
    defaultSender: testAccount,
    defaultSigner: testAccount.signer,
  });

  const tx = await client.send.reportRewards({
    args: [block],
    extraFee: (1000).microAlgos(),
    populateAppCallResources: true,
    firstValidRound: block,
  });
  console.log(`Reported rewards: ${tx.txIds}`);
}

export async function solveDelinquency(poolApp: bigint, block: bigint) {
  const { testAccount } = await getAccount();
  const client = algorand.client.getTypedAppClientById(CaelusValidatorPoolClient, {
    appId: poolApp,
    defaultSender: testAccount,
    defaultSigner: testAccount.signer,
  });

  const tx = await client.send.reportRewards({
    args: [block],
    populateAppCallResources: true,
    extraFee: (2000).microAlgos(),
    firstValidRound: block,
  });

  console.log(`Reported block to solve delinquency at: ${tx.txIds}`);
}

export async function deleteApp(poolApp: bigint) {
  const { testAccount } = await getAccount();

  const tx = await algorand.send.appDelete({
    sender: testAccount.addr,
    appId: poolApp,
    signer: testAccount,
    populateAppCallResources: true,
    onComplete: algosdk.OnApplicationComplete.DeleteApplicationOC,
  });

  console.log(`executed : ${tx.txIds}`);
}
