import * as algokit from '@algorandfoundation/algokit-utils';
import { CaelusAdminClient } from '../contracts/clients/CaelusAdminClient';

export function addValidator(
  algorand: algokit.AlgorandClient,
  caelus: CaelusAdminClient,
  sender: string,
  receiver: string
) {
  return async () => {
    const mbrPay = await algorand.transactions.payment({
      sender,
      receiver,
      amount: algokit.algos(0.1 + 0.3 + 0.25 + 0.3705),
    });

    await caelus.addCaelusValidator({ mbrPay });
  };
}

export function delayedMintRequest(
  algorand: algokit.AlgorandClient,
  caelus: CaelusAdminClient,
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

    await caelus.delayedMintRequest({ mintTxn });
  };
}

export function claimMint(caelus: CaelusAdminClient) {
  return async () => {
    await caelus.claimMint({});
  };
}

// TODO maybe also set up a getPremiumAmount txn call before (?)

export function instantMint(
  algorand: algokit.AlgorandClient,
  caelus: CaelusAdminClient,
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

    await caelus.instantMintRequest({ mintTxn });
  };
}

export function burn(
  algorand: algokit.AlgorandClient,
  caelus: CaelusAdminClient,
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

    await caelus.burnRequest({ burnTxn, burnTo });
  };
}

export function mintForValidator(
  algorand: algokit.AlgorandClient,
  caelus: CaelusAdminClient,
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
    await caelus.mintValidatorCommit({ validatorAppID: app, stakeCommit });
  };
}

export function burnForValidator(
  algorand: algokit.AlgorandClient,
  caelus: CaelusAdminClient,
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
    await caelus.burnValidatorCommit({ appToBurnFrom: app, burnTxn });
  };
}

export function burnValidatorCommitOnDelinquency(
  algorand: algokit.AlgorandClient,
  caelus: CaelusAdminClient,
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

    await caelus.burnToDelinquentValidator({ burnTxn, validatorAppID: app });
  };
}

export function reMintDeliquentCommit(caelus: CaelusAdminClient, amount: bigint, app: bigint) {
  return async () => {
    await caelus.reMintDeliquentCommit({ amount, app });
  };
}

export function bid(caelus: CaelusAdminClient, validatorAppID: bigint) {
  return async () => {
    await caelus.bid({ validatorAppID });
  };
}

export function snitchToBurn(caelus: CaelusAdminClient, app: bigint) {
  return async () => {
    await caelus.snitchToBurn({ app });
  };
}

export function multiSnitchToBurn(caelus: CaelusAdminClient, apps: number[]) {
  return async () => {
    await caelus.multiSnitchToBurn({ apps });
  };
}

export function declareRewards(
  algorand: algokit.AlgorandClient,
  caelus: CaelusAdminClient,
  sender: string,
  receiver: string,
  amount: number,
  app: bigint
) {
  return async () => {
    const txn = await algorand.transactions.payment({
      sender,
      receiver,
      amount: algokit.microAlgos(amount),
    });

    await caelus.declareRewards({ txn, ifValidator: app });
  };
}

export type SnitchInfoClient = {
  performanceCheck: boolean;
  stakeAmount: boolean;
  delinquentCheck: boolean;
  recipient: bigint | number;
  split: boolean;
  max: bigint | number;
};

export function snitch(caelus: CaelusAdminClient, paramsObj: SnitchInfoClient, app: bigint) {
  const params: [boolean, boolean, boolean, bigint | number, boolean, bigint | number] = [
    paramsObj.performanceCheck,
    paramsObj.stakeAmount,
    paramsObj.delinquentCheck,
    paramsObj.recipient,
    paramsObj.split,
    paramsObj.max,
  ];

  return async () => {
    await caelus.snitchCheck({ appToCheck: app, params });
  };
}

// TODO FLASHLOAN REQUEST + extraFees
