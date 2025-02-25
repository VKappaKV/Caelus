export type SnitchInfo = {
  performanceCheck: boolean;
  stakeAmountCheck: boolean;
  delinquentCheck: boolean;
  recipient: AppID; // must be either this.app or a validator
  split: boolean; // if clawback will be split between recipient and admin
  max: uint64; // use if split is true and set to the max amount to send to the validator
};

export const Values = {
  ALGORAND_ACCOUNT_MIN_BALANCE: 100000,
  ALGORAND_BASE_FEE: 1000,
  APPLICATION_BASE_FEE: 100000,
  ASSET_HOLDING_FEE: 100000,
  SSC_VALUE_UINT: 28500,
  SSC_VALUE_BYTES: 50000,
  VALIDATOR_POOL_CONTRACT_MBR: 1120500,
  PROTOCOL_COMMISSION: 4,
  VALIDATOR_COMMISSION: 6,
  OPERATOR_REPORT_MAX_TIME: 700,
  PERFORMANCE_STEP: 5,
  MAX_DELINQUENCY_TOLERATED: 10,
  BURN_COOLDOWN: 5,
  ALGORAND_STAKING_BLOCK_DELAY: 320,
  APPROX_AVG_ROUNDS_PER_DAY: 30857,
  PERFORMANCE_STAKE_INCREASE: 10000000000,
  MAX_STAKE_PER_ACCOUNT: 50000000000000,
  VEST_TIER_4: 100000000000,
  VEST_TIER_5: 150000000000,
  FLASH_LOAN_FEE: 10000000,
  SCALE: 100000,
  CLAIM_DELAY: 330,
};

export const StateKeys = {
  // ADMIN KEYS
  MANAGER: 'manager',
  VALIDATOR_POOL_APPROVAL_PROGRAM: 'validator_approval_program',
  VALIDATOR_POOL_CONTRACT_VERSION: 'validator_pool_version',
  VALIDATOR_POOL_CONTRACT_COST: 'validator_pool_cost',
  TOTAL_STAKE: 'total_stake',
  PEG_RATIO: 'peg_ratio',
  HIGHEST_BIDDER: 'highest_bidder',
  BURN_QUEUE: 'burn_queue',
  LAST_EXHAUST_BLOCK: 'last_exhaust_block',
  LAST_FLASHLOAN_BLOCK: 'last_flashloan_block',
  FLASHLOAN_COUNTER: 'flashloan_counter',
  // VALIDATOR KEYS
  CREATOR: 'creator',
  CONTRACT_VERSION: 'contract_version',
  VEST_ID: 'vest_id',
  STAKED_VEST_ID: 'staked_vest_id',
  TOKEN_ID: 'token_id',
  OPERATOR_ADDRESS: 'operator',
  OPERATOR_COMMIT: 'operator_commit',
  DELEGATED_STAKE: 'delegated_stake',
  MAX_DELEGATABLE_STAKE: 'max_delegatable_stake',
  STATUS: 'status',
  PERFORMANCE_COUNTER: 'performance',
  SATURATION_BUFFER: 'saturation_buffer',
  LAST_REWARD_REPORT: 'reward_report',
  LAST_DELINQUENCY_REPORT: 'delinquency_report',
  DELINQUENCY_SCORE: 'delinquency_score',
  BALANCE_CHECKPOINT: 'balance_checkpoint',
  REPAID: 'repaid',
};
