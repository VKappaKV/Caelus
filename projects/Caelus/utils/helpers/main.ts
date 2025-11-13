import { SigningAccount, TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account';
import { Address } from 'algosdk';
import { algorand } from '../network';
import { EquilibriumClient } from '../../contracts/clients/EquilibriumClient';

export type Account = Address & TransactionSignerAccount & { account: SigningAccount };

export async function clientSetUp(appId: bigint, account: Account) {
  return algorand.client.getTypedAppClientById(EquilibriumClient, {
    appId,
    defaultSender: account.addr,
    defaultSigner: account.signer,
  });
}

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
