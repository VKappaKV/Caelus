/* eslint-disable import/no-cycle */
/* eslint-disable no-use-before-define */
/* eslint-disable no-console */
/* eslint-disable no-await-in-loop */
import { AlgorandSubscriber } from '@algorandfoundation/algokit-subscriber';
import { TransactionType } from 'algosdk';
import { SubscribedTransaction } from '@algorandfoundation/algokit-subscriber/types/subscription';
import { CaelusValidatorPoolClient } from '../contracts/clients/CaelusValidatorPoolClient';
import { reportRewards } from './helpers/validator';
import { CaelusAdminClient } from '../contracts/clients/CaelusAdminClient';
import { getAccount } from './cli';
import { algorand, FEE_SINK_ADDRESS } from './helpers/network';
import { snitch } from './helpers/admin';

export const runner = async (adminAppId: bigint, myAppId: bigint, watermark: bigint) => {
  let currentWatermark = watermark;

  const { testAccount } = await getAccount(); // check in bootstrap.ts change this to your account, mnemonics are expected to be in ../env.ts

  const admin = algorand.client.getTypedAppClientById(CaelusAdminClient, {
    appId: adminAppId,
    defaultSender: testAccount,
    defaultSigner: testAccount.signer,
  });

  const subscriber = new AlgorandSubscriber(
    {
      syncBehaviour: 'skip-sync-newest',
      frequencyInSeconds: 3,
      maxRoundsToSync: 100,
      waitForBlockWhenAtTip: true,
      filters: [
        {
          name: 'payouts',
          filter: {
            sender: FEE_SINK_ADDRESS,
            type: TransactionType.pay,
          },
        },
        {
          name: 'bid',
          filter: {
            appId: adminAppId,
            type: TransactionType.appl,
            methodSignature: 'bid(uint64)void',
          },
        },
        {
          name: 'stake_delegation',
          filter: {
            appId: adminAppId,
            type: TransactionType.appl,
            receiver: admin.appAddress.toString(),
            methodSignature: 'delegateStake(uint64,uint64,pay)void',
          },
        },
        {
          name: 'burn',
          filter: {
            appId: adminAppId,
            arc28Events: [
              {
                groupName: 'burn',
                eventName: 'burnEvent',
              },
            ],
          },
        },
        {
          name: 'mint',
          filter: {
            appId: adminAppId,
            type: TransactionType.appl,
            methodSignature: 'mintRequest(pay)void',
          },
        },
        {
          name: 'mint_event',
          filter: {
            appId: adminAppId,
            arc28Events: [
              {
                groupName: 'mint',
                eventName: 'mintEvent',
              },
            ],
          },
        },
      ],
      watermarkPersistence: {
        get: async () => currentWatermark,
        set: async (newWatermark) => {
          currentWatermark = newWatermark;
        },
      },
    },
    algorand.client.algod,
    algorand.client.indexer
  );
  subscriber.on('payouts', async (tx) => onPayouts(tx, myAppId));
  subscriber.on('bid', async (tx) => onBidTracking(tx, admin, myAppId));
  subscriber.on('mint', async (tx) => onMintTracking(tx, admin, myAppId));
  subscriber.on('mint_event', async (tx) => onMintTracking(tx, admin, myAppId));
  subscriber.on('stake_delegation', async (tx) => onBidTracking(tx, admin, myAppId));
  subscriber.on('burn', async (tx) => onBurn(tx, admin, myAppId));
  subscriber.start();
};

const onPayouts = async (tx: SubscribedTransaction, myAppId: bigint) => {
  if (!tx) {
    console.log('No transaction found');
    return;
  }
  console.log('Payout detected', tx);
  const client = algorand.client.getTypedAppClientById(CaelusValidatorPoolClient, {
    appId: myAppId,
  });
  const appAddress = client.appAddress.toString();
  if (tx.paymentTransaction?.receiver === appAddress) {
    await new Promise((f) => {
      setTimeout(f, 10000);
    });
    await reportRewards(myAppId, tx.confirmedRound!);
  }
};

const onBidTracking = async (tx: SubscribedTransaction, adminClient: CaelusAdminClient, myAppId: bigint) => {
  console.log('Bid tracking detected', tx);
  if (!tx) {
    console.log('No transaction found');
    return;
  }
  const myValidator = algorand.client.getTypedAppClientById(CaelusValidatorPoolClient, {
    appId: myAppId,
  });
  await outBid(adminClient, myValidator);
};

const onMintTracking = async (tx: SubscribedTransaction, adminClient: CaelusAdminClient, myAppId: bigint) => {
  console.log('Mint tracking detected', tx);
  if (!tx) {
    console.log('No transaction found');
    return;
  }
  const myValidator = algorand.client.getTypedAppClientById(CaelusValidatorPoolClient, {
    appId: myAppId,
  });

  const isCurrentTopBidder = await adminClient.state.global.highestBidder(); // check if I am the current top bidder
  await outBid(adminClient, myValidator); // check if I need to outbid
  if (isCurrentTopBidder !== myAppId) return;

  const delegateTxn = await adminClient.send.delegateStake({
    args: [tx.paymentTransaction?.amount!],
    populateAppCallResources: true,
  });

  console.log('Taking more stake to my validator after mint event ', delegateTxn.confirmation);
};

async function outBid(admin: CaelusAdminClient, myValidator: CaelusValidatorPoolClient) {
  const currentTopBidder = await admin.state.global.highestBidder();
  const topBidderClient = algorand.client.getTypedAppClientById(CaelusValidatorPoolClient, {
    appId: currentTopBidder!,
  });
  const bufferOfTopBidder = await topBidderClient.state.global.saturationBuffer();
  const bufferOfMyApp = await myValidator.state.global.saturationBuffer();

  if (bufferOfTopBidder === undefined || bufferOfMyApp === undefined) {
    console.log('Buffer of top bidder or my app is undefined');
    return;
  }

  if (bufferOfTopBidder > bufferOfMyApp && currentTopBidder !== myValidator.appId) {
    console.log('Will outbid current top bidder');
    await admin.send.bid({ args: [myValidator.appId], populateAppCallResources: true });
  }
}

function uint8ArrayToBigIntArray(bytes: Uint8Array): bigint[] {
  const result: bigint[] = [];
  const BYTES_PER_BIGINT = 8;

  let i = 0;
  while (i < bytes.length) {
    let value = 0n;
    let j = 0;
    while (j < BYTES_PER_BIGINT) {
      value = value * 256n + BigInt(bytes[i + j] ?? 0);
      j += 1;
    }
    result.push(value);
    i += BYTES_PER_BIGINT;
  }

  return result;
}

const onBurn = async (tx: SubscribedTransaction, adminClient: CaelusAdminClient, myAppId: bigint) => {
  console.log('Burn detected', tx);

  const client = algorand.client.getTypedAppClientById(CaelusValidatorPoolClient, {
    appId: myAppId,
  });
  const currentQueue = (await adminClient.state.global.burnQueue()).asByteArray();
  if (currentQueue === undefined) {
    console.log('Burn queue is undefined');
    return;
  }
  const queue = uint8ArrayToBigIntArray(currentQueue);
  for (let i = 0; i < queue.length; i += 1) {
    if (queue[i] === 0n) {
      await adminClient.send.snitchToBurn({ args: [myAppId], populateAppCallResources: true });
      break;
    }
    const burningValidatorClient = algorand.client.getTypedAppClientById(CaelusValidatorPoolClient, {
      appId: queue[i],
    });
    const burningValidatorBuffer = await burningValidatorClient.state.global.saturationBuffer();
    const myValidatorBuffer = await client.state.global.saturationBuffer();
    if (burningValidatorBuffer === undefined || myValidatorBuffer === undefined) {
      console.log('Buffer of burning validator or my app is undefined');
      return;
    }
    if (burningValidatorBuffer < myValidatorBuffer) {
      await snitch(adminClient.appId, myAppId);
      break;
    }
  }
};
