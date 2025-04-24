import * as algokit from '@algorandfoundation/algokit-utils';
import algosdk from 'algosdk';
import { algorand } from './network';
import { getAccount } from './bootstrap';
import { CaelusAdminClient } from '../contracts/clients/CaelusAdminClient';
import { CaelusValidatorPoolClient } from '../contracts/clients/CaelusValidatorPoolClient';

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

/**
 * Mint and remove operator commit is in admin.ts
 */

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

  const solveTxn = await client.send.solveDelinquency({
    args: [block],
    populateAppCallResources: true,
    extraFee: (1000).microAlgos(),
  });

  console.log(`Reported block to solve delinquency at: ${solveTxn.txIds}`);
}

export async function goOnline(
  poolApp: bigint,
  votePK: Uint8Array,
  selectionPK: Uint8Array,
  stateProofPK: Uint8Array,
  voteFirst: bigint,
  voteLast: bigint,
  voteKeyDilution: bigint
) {
  const { testAccount } = await getAccount();
  const client = algorand.client.getTypedAppClientById(CaelusValidatorPoolClient, {
    appId: poolApp,
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });

  const payTxn = await algorand.createTransaction.payment({
    sender: testAccount.addr,
    receiver: client.appAddress,
    amount: (2).algos(),
  });

  const tx = await client.send.goOnline({
    args: [payTxn, votePK, selectionPK, stateProofPK, voteFirst, voteLast, voteKeyDilution],
    extraFee: (1000).microAlgos(),
    populateAppCallResources: true,
  });
  console.log(`Went online: ${tx.txIds}`);
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
