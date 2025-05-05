/* eslint-disable import/no-cycle */
/* eslint-disable no-console */
// import * as algokit from '@algorandfoundation/algokit-utils';
import algosdk from 'algosdk';
import { algorand } from './network';
import { getAccount } from '../cli';
import { CaelusValidatorPoolClient } from '../../contracts/clients/CaelusValidatorPoolClient';

/**
 * Add validator, Mint and remove operator commit is in admin.ts
 */

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
    extraFee: (2000).microAlgos(),
    populateAppCallResources: true,
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

  await client.send.reportRewards({
    args: [block],
    populateAppCallResources: true,
    extraFee: (2000).microAlgos(),
    firstValidRound: block,
    lastValidRound: block + 300n,
  });

  const solveTxn = await client.send.solveDelinquency({
    args: [block],
    populateAppCallResources: true,
    extraFee: (3000).microAlgos(),
  });

  console.log(`Reported block to solve delinquency at: ${solveTxn.txIds}`);
}

type SnitchInfo = {
  performanceCheck: boolean;
  stakeAmountCheck: boolean;
  delinquentCheck: boolean;
  versionCheck: boolean;
  recipient: bigint; // must be either this.app or a validator
  split: boolean; // if clawback will be split between recipient and admin
  max: bigint; // use if split is true and set to the max amount to send to the validator
};

export async function snitchApp(poolApp: bigint, snitchParams: SnitchInfo) {
  const { testAccount } = await getAccount();
  const client = algorand.client.getTypedAppClientById(CaelusValidatorPoolClient, {
    appId: poolApp,
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });
  const tx = await client.send.getSnitched({
    args: [
      [
        snitchParams.performanceCheck,
        snitchParams.stakeAmountCheck,
        snitchParams.delinquentCheck,
        snitchParams.versionCheck,
        snitchParams.recipient,
        snitchParams.split,
        snitchParams.max,
      ],
    ],
    extraFee: (5000).microAlgos(), // adjust this fee if needed
    populateAppCallResources: true,
  });
  console.log(`Snitched on app: ${tx.txIds}`);
}

export async function snitchOtherValidator(poolApp: bigint, validatorToSnitchApp: bigint, snitchParams: SnitchInfo) {
  const { testAccount } = await getAccount();
  const client = algorand.client.getTypedAppClientById(CaelusValidatorPoolClient, {
    appId: poolApp,
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });
  const tx = await client.send.snitchValidator({
    args: [
      validatorToSnitchApp,
      [
        snitchParams.performanceCheck,
        snitchParams.stakeAmountCheck,
        snitchParams.delinquentCheck,
        snitchParams.versionCheck,
        snitchParams.recipient,
        snitchParams.split,
        snitchParams.max,
      ],
    ],
    extraFee: (7000).microAlgos(),
    populateAppCallResources: true,
  });
  console.log(`Snitched on app: ${tx.txIds}`);
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

export async function goOffline(poolApp: bigint) {
  const { testAccount } = await getAccount();
  const client = algorand.client.getTypedAppClientById(CaelusValidatorPoolClient, {
    appId: poolApp,
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });

  const offlineTxn = await client.send.goOffline({
    args: [],
    extraFee: (1000).microAlgos(),
    populateAppCallResources: true,
  });
  console.log(`Went offline: ${offlineTxn.txIds}`);
}

export async function migrate(poolApp: bigint, newPoolApp: bigint) {
  const { testAccount } = await getAccount();
  const client = algorand.client.getTypedAppClientById(CaelusValidatorPoolClient, {
    appId: poolApp,
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });

  const tx = await client.send.migrateToPool({
    args: [newPoolApp],
    extraFee: (5000).microAlgos(),
    populateAppCallResources: true,
  });
  console.log(`Migrated to new pool app: ${tx.txIds}`);
}

export async function claimDust(poolApp: bigint) {
  const { testAccount } = await getAccount();
  const client = algorand.client.getTypedAppClientById(CaelusValidatorPoolClient, {
    appId: poolApp,
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });
  const tx = await client.send.claimLeftAlgo({
    args: [],
    extraFee: (1000).microAlgos(),
    populateAppCallResources: true,
  });
  console.log(`Claimed dust: ${tx.txIds}`);
}

export async function deleteApp(poolApp: bigint) {
  const { testAccount } = await getAccount();

  const tx = await algorand.send.appDelete({
    sender: testAccount.addr,
    appId: poolApp,
    signer: testAccount,
    populateAppCallResources: true,
    extraFee: (2000).microAlgos(),
    onComplete: algosdk.OnApplicationComplete.DeleteApplicationOC,
  });

  console.log(`executed : ${tx.txIds}`);
}
