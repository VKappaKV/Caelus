import { algorand } from './network';
import { EquilibriumClient } from '../../contracts/clients/EquilibriumClient';
import { Account } from '../types/account';
import { PartKey } from '../types/partkey';

export async function init(account: Account, client: EquilibriumClient) {
  const group = client.newGroup();

  const fundTxn = await algorand.createTransaction.payment({
    sender: account.addr,
    receiver: client.appAddress,
    amount: (1).algos(),
  });

  group.addTransaction(fundTxn).init({ args: [fundTxn] });
  await group.send({ populateAppCallResources: true, coverAppCallInnerTransactionFees: true });
}

export async function mint(amount: number, account: Account, client: EquilibriumClient) {
  const group = client.newGroup();
  const payTxn = await algorand.createTransaction.payment({
    sender: account.addr,
    receiver: client.appAddress,
    amount: amount.algos(),
  });

  group.addTransaction(payTxn).mint({ args: [payTxn] });
  await group.send({ populateAppCallResources: true, coverAppCallInnerTransactionFees: true });
}

export async function burn(amount: bigint, account: Account, client: EquilibriumClient) {
  const token = (await client.state.global.tokenId()) ?? BigInt(0);

  const axferTxn = await algorand.createTransaction.assetTransfer({
    sender: account.addr,
    receiver: client.appAddress,
    amount,
    assetId: token,
  });

  const group = client.newGroup();
  group.addTransaction(axferTxn).burn({ args: [axferTxn] });
  await group.send({ populateAppCallResources: true, coverAppCallInnerTransactionFees: true });
}

export async function snitch(account: string, client: EquilibriumClient) {
  await client.send.snitch({ args: [account], populateAppCallResources: true, coverAppCallInnerTransactionFees: true });
}

export async function bid(account: string, client: EquilibriumClient) {
  await client.send.bid({ args: [account], populateAppCallResources: true, coverAppCallInnerTransactionFees: true });
}

export async function delegate(amount: number, client: EquilibriumClient) {
  await client.send.delegate({
    args: [amount],
    populateAppCallResources: true,
    coverAppCallInnerTransactionFees: true,
  });
}

export async function spawn(account: Account, client: EquilibriumClient) {
  const mbrTxn = await algorand.createTransaction.payment({
    sender: account.addr,
    receiver: client.appAddress,
    amount: (2.0419).algos(),
  });
  const group = client.newGroup();

  await group
    .addTransaction(mbrTxn)
    .spawnValidator({ args: [mbrTxn] })
    .send({ populateAppCallResources: true, coverAppCallInnerTransactionFees: true });
}

export async function commit(account: Account, client: EquilibriumClient, amount: number) {
  const commitTxn = await algorand.createTransaction.payment({
    sender: account.addr,
    receiver: client.appAddress,
    amount: amount.algos(),
  });

  const group = client.newGroup();
  await group
    .addTransaction(commitTxn)
    .operatorCommit({ args: [commitTxn] })
    .send({ populateAppCallResources: true, coverAppCallInnerTransactionFees: true });
}

export async function retract(account: Account, client: EquilibriumClient, amount: bigint) {
  await client.send.operatorUnstake({
    sender: account.addr,
    signer: account.signer,
    args: [amount],
    populateAppCallResources: true,
    coverAppCallInnerTransactionFees: true,
  });
}

export async function online(account: Account, client: EquilibriumClient, partKey: PartKey) {
  const onlineFeePayTxn = await algorand.createTransaction.payment({
    sender: account.addr,
    receiver: client.appAddress,
    amount: (2).algos(),
  });

  const group = client.newGroup();
  group.addTransaction(onlineFeePayTxn).goOnline({
    args: [
      onlineFeePayTxn,
      partKey.votingKey,
      partKey.selectionKey,
      partKey.stateProofKey,
      partKey.firstRound,
      partKey.lastRound,
      partKey.keyDilution,
    ],
  });
  await group.send({ populateAppCallResources: true, coverAppCallInnerTransactionFees: true });
}

export async function offline(account: Account, client: EquilibriumClient) {
  await client.send.goOffline({
    sender: account.addr,
    signer: account.signer,
    args: [],
    populateAppCallResources: true,
    coverAppCallInnerTransactionFees: true,
  });
}

export async function report(account: Account, client: EquilibriumClient, blockHash: bigint) {
  await client.send.reportBlock({
    args: [blockHash],
    sender: account.addr,
    signer: account.signer,
    populateAppCallResources: true,
    coverAppCallInnerTransactionFees: true,
  });
}
