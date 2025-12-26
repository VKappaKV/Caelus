import { SigningAccount, TransactionSignerAccount } from '@algorandfoundation/algokit-utils/types/account';
import { Address } from 'algosdk';

export type Account = Address & TransactionSignerAccount & { account: SigningAccount };
