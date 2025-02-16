export const ALGORAND_ACCOUNT_MIN_BALANCE = 100000;
export const ALGORAND_BASE_FEE = 1000;
export const APPLICATION_BASE_FEE = 100000; // base fee for creating or opt-in to application
export const ASSET_HOLDING_FEE = 100000; // creation/holding fee for asset
export const SSC_VALUE_UINT = 28500; // cost for value as uint64
export const SSC_VALUE_BYTES = 50000; // cost for value as bytes
// export const ALGORAND_BASE_FEE = 1000;
export const VALIDATOR_POOL_CONTRACT_MBR = 1120500; // 1_120_500

export const PROTOCOL_COMMISSION = 4;
export const VALIDATOR_COMMISSION = 6;
export const OPERATOR_REPORT_MAX_TIME = 700;

export const PERFORMANCE_STEP = 5;
export const MAX_DELINQUENCY_TOLERATED = 10;
export const BURN_COOLDOWN = 5;

export const ALGORAND_STAKING_BLOCK_DELAY = 320; // # of blocks until algorand sees online balance changes in staking
export const APPROX_AVG_ROUNDS_PER_DAY = 30857; // approx 'daily' rounds for APR bins (60*60*24/2.8)

export const PERFORMANCE_STAKE_INCREASE = 10000000000; // 10_000_000_000

export const MAX_STAKE_PER_ACCOUNT = 50000000000000; // 50_000_000_000_000

export const VEST_TIER_4 = 100000000000; // 100_000_000_000
export const VEST_TIER_5 = 150000000000; // 150_000_000_000

export const FLASH_LOAN_FEE = 10000000; // 10_000_000

export const SCALE = 100000; // 100_000

export const CLAIM_DELAY = 330;

export type SnitchInfo = {
  performanceCheck: boolean;
  stakeAmountCheck: boolean;
  delinquentCheck: boolean;
  recipient: AppID; // must be either this.app or a validator
  split: boolean; // if clawback will be split between recipient and admin
  max: uint64; // use if split is true and set to the max amount to send to the validator
};
