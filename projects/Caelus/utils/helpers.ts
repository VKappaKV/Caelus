import * as algokit from '@algorandfoundation/algokit-utils';
// import { consoleLogger } from '@algorandfoundation/algokit-utils/types/logging';
// import { Config } from '@algorandfoundation/algokit-utils';
// import algosdk from 'algosdk';
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
    (account) => account.address === '6D2HEIEYZK4QTQ4G5HJI3C3UARAWXYMAGKK24GHLTAJFQIBCFENCYJHVFA'
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

// export async function burn() {}

// VALIDATOR METHODS

export async function validatorOptIntoLST(poolApp: bigint) {
  const { testAccount } = await getAccount();
  const client = algorand.client.getTypedAppClientById(CaelusValidatorPoolClient, {
    appId: poolApp,
    defaultSender: testAccount.addr,
    defaultSigner: testAccount.signer,
  });
  await algorand.createTransaction.payment({
    sender: testAccount.addr,
    receiver: client.appAddress,
    amount: (0.2).algos(),
  });
  const tx = await client.send.optIntoLst();
  console.log(`Opted into LST: ${tx.txIds}`);
}
