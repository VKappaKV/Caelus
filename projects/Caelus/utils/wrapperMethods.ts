import * as algokit from '@algorandfoundation/algokit-utils';
import { CaelusAdminClient } from '../contracts/clients/CaelusAdminClient';
import { CaelusValidatorPoolClient } from '../contracts/clients/CaelusValidatorPoolClient';

export function addValidator(
  algorand: algokit.AlgorandClient,
  caelusAdmin: CaelusAdminClient,
  sender: string,
  receiver: string
) {
  return async () => {
    const mbrPay = await algorand.transactions.payment({
      sender,
      receiver,
      amount: algokit.algos(0.1 + 0.3 + 0.25 + 0.3705),
    });

    await caelusAdmin.addCaelusValidator({ mbrPay });
  };
}

export function delayedMintRequest(
  algorand: algokit.AlgorandClient,
  caelusAdmin: CaelusAdminClient,
  sender: string,
  receiver: string,
  amount: number
) {
  return async () => {
    const mintTxn = await algorand.transactions.payment({
      sender,
      receiver,
      amount: algokit.microAlgos(amount),
    });

    await caelusAdmin.delayedMintRequest({ mintTxn });
  };
}

export function claimMint(caelusAdmin: CaelusAdminClient) {
  return async () => {
    await caelusAdmin.claimMint({});
  };
}

// TODO maybe also set up a getPremiumAmount txn call before (?)

export function instantMint(
  algorand: algokit.AlgorandClient,
  caelusAdmin: CaelusAdminClient,
  sender: string,
  receiver: string,
  amount: number
) {
  return async () => {
    const mintTxn = await algorand.transactions.payment({
      sender,
      receiver,
      amount: algokit.microAlgos(amount),
    });

    await caelusAdmin.instantMintRequest({ mintTxn });
  };
}

export function burn(
  algorand: algokit.AlgorandClient,
  caelusAdmin: CaelusAdminClient,
  sender: string,
  receiver: string,
  amount: number,
  burnTo: string
) {
  return async () => {
    const burnTxn = await algorand.transactions.payment({
      sender,
      receiver,
      amount: algokit.microAlgos(amount),
    });

    await caelusAdmin.burnRequest({ burnTxn, burnTo });
  };
}

export function mintForValidator(
  algorand: algokit.AlgorandClient,
  caelusAdmin: CaelusAdminClient,
  sender: string,
  receiver: string,
  amount: number,
  app: bigint
) {
  return async () => {
    const stakeCommit = await algorand.transactions.payment({
      sender,
      receiver,
      amount: algokit.microAlgos(amount),
    });
    const validatorAppID = app;
    await caelusAdmin.mintValidatorCommit({ validatorAppID, stakeCommit });
  };
}

export function burnForValidator(
  algorand: algokit.AlgorandClient,
  caelusAdmin: CaelusAdminClient,
  sender: string,
  receiver: string,
  amount: bigint,
  assetId: bigint,
  app: bigint
) {
  return async () => {
    const burnTxn = await algorand.transactions.assetTransfer({
      assetId,
      sender,
      receiver,
      amount,
    });
    const appToBurnFrom = app;
    await caelusAdmin.burnValidatorCommit({ appToBurnFrom, burnTxn });
  };
}

export function burnValidatorCommitOnDelinquency(
  algorand: algokit.AlgorandClient,
  caelusAdmin: CaelusAdminClient,
  sender: string,
  receiver: string,
  amount: bigint,
  assetId: bigint,
  app: bigint
) {
  return async () => {
    const burnTxn = await algorand.transactions.assetTransfer({
      assetId,
      sender,
      receiver,
      amount,
    });

    const validatorAppID = app;
    await caelusAdmin.burnToDelinquentValidator({ burnTxn, validatorAppID });
  };
}

export function reMintDeliquentCommit(caelusAdmin: CaelusAdminClient, amount: bigint, app: bigint) {
  return async () => {
    await caelusAdmin.reMintDeliquentCommit({ amount, app });
  };
}

export function bid(caelusAdmin: CaelusAdminClient, validatorAppID: bigint) {
  return async () => {
    await caelusAdmin.bid({ validatorAppID });
  };
}

export function snitchToBurn(caelusAdmin: CaelusAdminClient, app: bigint) {
  return async () => {
    await caelusAdmin.snitchToBurn({ app });
  };
}

export function multiSnitchToBurn(caelusAdmin: CaelusAdminClient, apps: number[]) {
  return async () => {
    await caelusAdmin.multiSnitchToBurn({ apps });
  };
}

export function declareRewards() {}
