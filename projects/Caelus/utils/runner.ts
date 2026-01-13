import { AlgorandSubscriber } from '@algorandfoundation/algokit-subscriber';
import { TransactionType } from 'algosdk';
import { SubscribedTransaction } from '@algorandfoundation/algokit-subscriber/types/subscription';
import { algorand, FEE_SINK_ADDRESS } from './helpers/network';
import { report, snitch } from './helpers/appCalls';
import { Account } from './types/account';
import { EquilibriumClient } from '../contracts/clients/EquilibriumClient';
import { getAddress } from './helpers/misc';

export const runner = async (adminAppId: bigint, watermark: bigint, testAccount: Account) => {
  let currentWatermark = watermark; // check in bootstrap.ts change this to your account, mnemonics are expected to be in ../env.ts

  const admin = algorand.client.getTypedAppClientById(EquilibriumClient, {
    appId: adminAppId,
    defaultSender: testAccount,
    defaultSigner: testAccount.signer,
  });

  const myValidator = await getAddress();

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
          name: 'declared_reward',
          filter: {
            appId: adminAppId,
            type: TransactionType.appl,
            methodSignature: 'declareRewards(uint64,uint64,pay)void',
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
  subscriber.on('payouts', async (tx) => onPayouts(tx, admin, testAccount));
  subscriber.on('bid', async (tx) => onBidTracking(tx, admin, myValidator));
  subscriber.on('mint', async (tx) => onMintTracking(tx, admin, myValidator));
  subscriber.on('declared_reward', async (tx) => onMintTracking(tx, admin, myValidator));
  subscriber.on('stake_delegation', async (tx) => onBidTracking(tx, admin, myValidator));
  subscriber.on('burn', async (tx) => onBurn(tx, admin, myValidator));
  subscriber.onError((error) => {
    console.error('Error in subscriber', error);
  });
  subscriber.start();
};

const onPayouts = async (tx: SubscribedTransaction, client: EquilibriumClient, account: Account) => {
  if (!tx) {
    console.log('No transaction found');
    return;
  }
  console.log('Payout detected', tx);
  const appAddress = client.appAddress.toString();
  if (tx.paymentTransaction?.receiver === appAddress) {
    await new Promise((f) => {
      setTimeout(f, 10000);
    });
    await report(account, client, tx.confirmedRound!);
  }
};

const onBidTracking = async (tx: SubscribedTransaction, client: EquilibriumClient, myValidator: string) => {
  console.log('Bid tracking detected', tx);
  if (!tx) {
    console.log('No transaction found');
    return;
  }
  await outBid(client, myValidator);
};

const onMintTracking = async (tx: SubscribedTransaction, client: EquilibriumClient, myValidator: string) => {
  console.log('Mint tracking detected', tx);
  if (!tx) {
    console.log('No transaction found');
    return;
  }

  await outBid(client, myValidator);

  const currentTopBidder = await client.state.global.highestBidder();
  console.log('Current top bidder', currentTopBidder);
  if (currentTopBidder === myValidator) {
    console.log('I am the top bidder, taking more stake');
    const adminInfo = await algorand.account.getInformation(client.appAddress);
    const availableAdminBalance =
      adminInfo.balance.microAlgos > adminInfo.minBalance.microAlgos
        ? adminInfo.balance.microAlgos - adminInfo.minBalance.microAlgos
        : 0n;

    const delegateTxn = await client.send.delegate({
      args: [availableAdminBalance],
      populateAppCallResources: true,
      coverAppCallInnerTransactionFees: true,
    });

    console.log('Taking more stake to my validator', delegateTxn.confirmation);
  }
};

async function outBid(admin: EquilibriumClient, myValidator: string) {
  const currentTopBidder = await admin.state.global.highestBidder();
  const topBidderClient = algorand.client.getTypedAppClientById(EquilibriumClient, {
    appId: currentTopBidder!,
  });
  const bufferOfTopBidder = await topBidderClient.state.global.saturationBuffer();
  const bufferOfMyApp = await myValidator.state.global.saturationBuffer();

  if (bufferOfTopBidder === undefined || bufferOfMyApp === undefined) {
    console.log('Buffer of top bidder or my app is undefined');
    return;
  }

  if (bufferOfTopBidder > bufferOfMyApp && currentTopBidder !== myValidator.appId) {
    console.log('Will outbid current top bidder, new bidder is', myValidator.appId);
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

const onBurn = async (tx: SubscribedTransaction, adminClient: EquilibriumClient, myAppId: string) => {
  console.log('Burn detected', tx);

  const currentQueue = await adminClient.state;
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
