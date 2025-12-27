import * as dotenv from 'dotenv';
import { algorand } from './network';

dotenv.config();

export const { ADMIN_APP_ID, VALIDATOR_APP_ID, MNEMONIC } = process.env;

if (!ADMIN_APP_ID || !VALIDATOR_APP_ID || !MNEMONIC || MNEMONIC === '') {
  throw new Error(
    'Remember to set the .env file, follow the structure in the .env.template file. Fill the MNEMONICs with the account mnemonics'
  );
}

export const getAccount = async () => {
  const testAccount = algorand.account.fromMnemonic(MNEMONIC);

  const random = algorand.account.random();

  return { testAccount, random };
};
