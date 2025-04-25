import * as algokit from '@algorandfoundation/algokit-utils';

const ALGOD_ENDPOINT = 'https://fnet-api.4160.nodely.dev';
const ALGOD_TOKEN = '';
const ALGOD_PORT = 443;

const INDEXER_ENDPOINT = 'https://fnet-idx.4160.nodely.io:443';
const INDEXER_TOKEN = '';
const INDEXER_PORT = 443;

export const FEE_SINK_ADDRESS = 'FEESINK7OJKODDB5ZB4W2SRYPUSTOTK65UDCUYZ5DB4BW3VOHDHGO6JUNE'; // fnet
// const FEE_SINK_ADDRESS = 'Y76M3MSY6DKBRHBL7C3NNDXGS5IIMQVQVUAB6MP4XEMMGVF2QWNPL226CA'; // mainnet

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
