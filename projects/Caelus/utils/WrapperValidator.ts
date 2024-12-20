import * as algokit from '@algorandfoundation/algokit-utils';
import { CaelusValidatorPoolClient } from '../contracts/clients/CaelusValidatorPoolClient';
import { SnitchInfoClient } from './WrapperAdmin';

export function optIntoLST(caelus: CaelusValidatorPoolClient) {
  return async () => {
    await caelus.optIntoLst({});
  };
}

export function burnForValidator(caelus: CaelusValidatorPoolClient, amount: bigint) {
  return async () => {
    await caelus.initBurnOperatorCommit({ claimRequestLST: amount });
  };
}

export function performanceCheck(caelus: CaelusValidatorPoolClient) {
  return async () => {
    await caelus.performanceCheck({});
  };
}

export function solveDelinquency(caelus: CaelusValidatorPoolClient, block: bigint) {
  return async () => {
    await caelus.solveDelinquency({ block });
  };
}

export function reportRewards(caelus: CaelusValidatorPoolClient, block: bigint) {
  return async () => {
    await caelus.reportRewards({ block });
  };
}

export function snitch(caelus: CaelusValidatorPoolClient, paramsObj: SnitchInfoClient, app: bigint) {
  const params: [boolean, boolean, boolean, bigint | number, boolean, bigint | number] = [
    paramsObj.performanceCheck,
    paramsObj.stakeAmount,
    paramsObj.delinquentCheck,
    paramsObj.recipient,
    paramsObj.split,
    paramsObj.max,
  ];

  return async () => {
    await caelus.snitchValidator({ appToSnitch: app, params });
  };
}

export function claimDust(caelus: CaelusValidatorPoolClient) {
  return async () => {
    await caelus.claimLeftAlgo({});
  };
}

export function makeCloseTxn(caelus: CaelusValidatorPoolClient) {
  return async () => {
    await caelus.makeCloseTxn({});
  };
}

export function goOnline(
  algorand: algokit.AlgorandClient,
  caelus: CaelusValidatorPoolClient,
  sender: string,
  receiver: string,
  amount: bigint,
  votePK: Uint8Array,
  selectionPK: Uint8Array,
  stateProofPK: Uint8Array,
  voteFirst: bigint,
  voteLast: bigint,
  voteKeyDilution: bigint
) {
  return async () => {
    const txn = await algorand.transactions.payment({
      sender,
      receiver,
      amount: algokit.microAlgos(Number(amount)),
    });
    await caelus.goOnline({ feePayment: txn, votePK, selectionPK, stateProofPK, voteFirst, voteLast, voteKeyDilution });
  };
}

export function goOffline(caelus: CaelusValidatorPoolClient) {
  return async () => {
    await caelus.goOffline({});
  };
}
