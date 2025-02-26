import * as algokit from '@algorandfoundation/algokit-utils';
// import { consoleLogger } from '@algorandfoundation/algokit-utils/types/logging';
// import { Config } from '@algorandfoundation/algokit-utils';
import algosdk from 'algosdk';
import { CaelusAdminClient } from '../contracts/clients/CaelusAdminClient';
import { CaelusValidatorPoolClient } from '../contracts/clients/CaelusValidatorPoolClient';
/* eslint-disable no-console */

const algorand = algokit.AlgorandClient.fromConfig({
  algodConfig: {
    server: 'http://localhost',
    token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    port: 4001,
  },
  indexerConfig: {
    server: 'http://localhost',
    token: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    port: 8980,
  },
});

/**
 * Change manually after Deploying
 */

const getAccount = async () => {
  const testAccount = await algorand.account.fromKmd(
    'lora-dev',
    (account) => account.address === 'NYSW5ZHRHQX6P7MVKPLXVQOP7X7KNHJL74VHRMKW5TAJLQAZGO2R3UAF7E'
  );

  const random = algorand.account.random();

  return { testAccount, random };
};

const APP_ID = 1002n;

// ADMIN METHODS

export async function mint() {
  const { testAccount } = await getAccount();
  const client = algorand.client.getTypedAppClientById(CaelusAdminClient, {
    appId: APP_ID,
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });
  const pay = await algorand.createTransaction.payment({
    sender: testAccount.addr,
    receiver: client.appAddress,
    amount: (100).algos(),
  });

  const mintTxn = await client.send.mintRequest({ args: [pay], populateAppCallResources: true });

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

// export async function burn() {}

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

export async function deleteApp(poolApp: bigint) {
  const { testAccount } = await getAccount();
  const client = algorand.client.getTypedAppClientById(CaelusValidatorPoolClient, {
    appId: poolApp,
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });

  const tx = await algorand.send.appDelete({
    sender: testAccount.addr,
    appId: poolApp,
    signer: testAccount,
    populateAppCallResources: true,
    onComplete: algosdk.OnApplicationComplete.DeleteApplicationOC,
  });

  console.log(`executed : ${tx.txIds}`);
}
