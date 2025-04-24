import * as algokit from '@algorandfoundation/algokit-utils';

const ALGOD_ENDPOINT = 'https://fnet-api.4160.nodely.dev';
const ALGOD_TOKEN = '';
const ALGOD_PORT = 443;

const INDEXER_ENDPOINT = 'https://fnet-idx.4160.nodely.io:443';
const INDEXER_TOKEN = '';
const INDEXER_PORT = 443;

// const ALGOD_ENDPOINT = 'http://localhost/';
// const ALGOD_TOKEN = 'a'.repeat(64);
// const ALGOD_PORT = 4001;

// const INDEXER_ENDPOINT = 'http://localhost/';
// const INDEXER_TOKEN = 'a'.repeat(64);
// const INDEXER_PORT = 8980;

export const algorand = algokit.AlgorandClient.fromConfig({
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
