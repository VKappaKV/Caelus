import * as algokit from '@algorandfoundation/algokit-utils';
import { Address } from 'algosdk';
import { CaelusAdminClient } from '../contracts/clients/CaelusAdminClient';
import { CaelusValidatorPoolClient } from '../contracts/clients/CaelusValidatorPoolClient';

export const create = (
  algorand: algokit.AlgorandClient,
  caelusAdmin: CaelusAdminClient,
  setAppID: (id: number) => void
) => {
  return async () => {
    const result = await caelusAdmin.create.createApplication({});
    setAppID(Number(result.appId));

    // does it need to include a funding transaction?
  };
};

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
