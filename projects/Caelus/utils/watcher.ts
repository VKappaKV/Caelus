import * as algokit from '@algorandfoundation/algokit-utils';
import { AlgorandSubscriber } from '@algorandfoundation/algokit-subscriber';
import { TransactionType } from 'algosdk';

const ALGOD_ENDPOINT = 'https://fnet-api.4160.nodely.dev';
const ALGOD_TOKEN = '';
const ALGOD_PORT = 443;

const INDEXER_ENDPOINT = 'https://fnet-idx.4160.nodely.io:443';
const INDEXER_TOKEN = '';
const INDEXER_PORT = 443;

const algorand = algokit.AlgorandClient.fromConfig({
  algodConfig: {
    server: ALGOD_ENDPOINT,
    token: ALGOD_TOKEN,
    port: ALGOD_PORT,
  },
  indexerConfig: {
    server: INDEXER_ENDPOINT,
    token: INDEXER_TOKEN,
    port: INDEXER_PORT,
  },
});

let watermark = 0n;

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
          sender: 'Y76M3MSY6DKBRHBL7C3NNDXGS5IIMQVQVUAB6MP4XEMMGVF2QWNPL226CA',
          type: TransactionType.pay,
        },
      },
    ],
    watermarkPersistence: {
      get: async () => watermark,
      set: async (newWatermark) => {
        watermark = newWatermark;
      },
    },
  },
  algorand.client.algod,
  algorand.client.indexer
);

subscriber.start();
