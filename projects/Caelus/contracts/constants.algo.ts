export type SnitchInfo = {
  performanceCheck: boolean;
  stakeAmountCheck: boolean;
  versionCheck: boolean;
  recipient: AppID; // must be either this.app or a validator
};

export const ALGORAND_BASE_FEE = 1000;

export const MBR_OPT_IN = 100_000;
export const ACCOUNT_MIN_BALANCE = 100_000;

export const VALIDATOR_POOL_MBR = 2_040_900;
export const BURN_QUEUE_MBR = 134_500;

export const PROTOCOL_COMMISSION = 4;
export const VALIDATOR_COMMISSION = 6;

export const OPERATOR_REPORT_MAX_TIME = 700;
export const PERFORMANCE_STEP = 5;

export const MAX_DELINQUENCY_TOLERATED = 10;
export const BURN_COOLDOWN = 5;

export const PERFORMANCE_STAKE_INCREASE = 10_000_000_000;
export const MAX_STAKE_PER_ACCOUNT = 50_000_000_000_000;

export const FLASH_LOAN_FEE = 10_000_000;

export const SCALE = 1_000_000;

export const NEUTRAL_STATUS = 0;
export const NOT_DELEGATABLE_STATUS = 1;
export const DELINQUENCY_STATUS = 2;

export const BUFFER_MAX = 1_000_000;

export const UPDATABLE = 0;
export const LOCKED = 1;
