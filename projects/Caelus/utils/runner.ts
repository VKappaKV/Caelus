/* eslint-disable no-use-before-define */
/* eslint-disable no-console */
/* eslint-disable no-await-in-loop */
import { AlgorandSubscriber } from '@algorandfoundation/algokit-subscriber';
import { TransactionType } from 'algosdk';
import { SubscribedTransaction } from '@algorandfoundation/algokit-subscriber/types/subscription';
import { CaelusValidatorPoolClient } from '../contracts/clients/CaelusValidatorPoolClient';
import { reportRewards } from './validator';
import { CaelusAdminClient } from '../contracts/clients/CaelusAdminClient';
import { getAccount } from './bootstrap';
import { algorand } from './network';

export const runner = async (adminAppId: bigint, myAppId: bigint, watermark: bigint) => {
  let currentWatermark = watermark;

  const { testAccount } = await getAccount(); // check in bootstrap.ts change this to your account through env.ts

  const admin = algorand.client.getTypedAppClientById(CaelusAdminClient, {
    appId: adminAppId,
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
            sender: 'FEESINK7OJKODDB5ZB4W2SRYPUSTOTK65UDCUYZ5DB4BW3VOHDHGO6JUNE', // mainnet fee sink address 'Y76M3MSY6DKBRHBL7C3NNDXGS5IIMQVQVUAB6MP4XEMMGVF2QWNPL226CA'
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
  subscriber.on('payouts', (tx) => onPayouts(tx, myAppId));
  subscriber.on('bid', (tx) => onBidTracking(tx, adminAppId, myAppId));
  subscriber.on('mint_event', async (tx) => onMintTracking(tx, adminAppId, myAppId));
  subscriber.on('stake_delegation', async (tx) => onBidTracking(tx, adminAppId, myAppId));
  subscriber.on('burn', async (tx) => onBurn(tx, adminAppId, myAppId));
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
    await reportRewards(myAppId, tx.confirmedRound!);
  }
};

const onBidTracking = async (tx: SubscribedTransaction, adminAppId: bigint, myAppId: bigint) => {
  if (!tx) {
    console.log('No transaction found');
    return;
  }
  const myValidator = algorand.client.getTypedAppClientById(CaelusValidatorPoolClient, {
    appId: myAppId,
  });
  const admin = algorand.client.getTypedAppClientById(CaelusAdminClient, {
    appId: adminAppId,
  });
  console.log('Bid detected', tx);
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

  if (bufferOfTopBidder > bufferOfMyApp) {
    console.log('Will outbid current top bidder');
    await admin.send.bid({ args: [myAppId], populateAppCallResources: true });
  }
};

const onMintTracking = async (tx: SubscribedTransaction, adminAppId: bigint, myAppId: bigint) => {
  if (!tx) {
    console.log('No transaction found');
    return;
  }
  const admin = algorand.client.getTypedAppClientById(CaelusAdminClient, {
    appId: adminAppId,
  });

  const isCurrentTopBidder = await admin.state.global.highestBidder(); // check if I am the current top bidder
  if (isCurrentTopBidder !== myAppId) return;

  const delegateTxn = await admin.send.delegateStake({
    args: [tx.paymentTransaction?.amount!, myAppId],
    populateAppCallResources: true,
  });

  console.log('Taking more stake to my validator after mint event ', delegateTxn.confirmation);
};

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

const onBurn = async (tx: SubscribedTransaction, adminAppId: bigint, myAppId: bigint) => {
  console.log('Burn detected', tx);
  const admin = algorand.client.getTypedAppClientById(CaelusAdminClient, {
    appId: adminAppId,
  });
  const client = algorand.client.getTypedAppClientById(CaelusValidatorPoolClient, {
    appId: myAppId,
  });
  const currentQueue = (await admin.state.global.burnQueue()).asByteArray();
  if (currentQueue === undefined) {
    console.log('Burn queue is undefined');
    return;
  }
  const queue = uint8ArrayToBigIntArray(currentQueue);
  for (let i = 0; i < queue.length; i += 1) {
    if (queue[i] === 0n) {
      await admin.send.snitchToBurn({ args: [myAppId], populateAppCallResources: true });
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
      await admin.send.snitchToBurn({ args: [myAppId], populateAppCallResources: true });
      break;
    }
  }
};

// export const trackValidatorPerformances = async (myAppId: bigint, watermark: bigint) => {}; // if I track it on each payout it might be too much, maybe move this to just a frontend
