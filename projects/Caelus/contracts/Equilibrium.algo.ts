/* eslint-disable camelcase */
import { Contract } from '@algorandfoundation/tealscript';
import {
  ALGORAND_BASE_FEE,
  BUFFER_MAX,
  MAX_STAKE_PER_ACCOUNT,
  MBR_OPT_IN,
  NEUTRAL_STATUS,
  NOT_DELEGATABLE_STATUS,
  PROTOCOL_COMMISSION,
  SCALE,
  VALIDATOR_POOL_MBR,
  PERFORMANCE_STAKE_INCREASE,
  PERFORMANCE_STEP,
  OPERATOR_REPORT_MAX_TIME,
  VALIDATOR_COMMISSION,
} from './constants.algo';
import { Puppet } from './Puppet.algo';

interface Validator {
  operator: Address;
  commit: uint64;
  yielded: uint64;
  delegated: uint64;
  performance: uint64;
  buffer: uint64;
  status: uint64;
  last_block: uint64;
  last_report: uint64;
  delinquency: uint64;
}

export class Equilibrium extends Contract {
  programVersion = 11;

  manager = GlobalStateKey<Address>({ key: 'manager' });

  protocol_fee = GlobalStateKey<uint64>({ key: 'protocol_fee' });

  total_stake = GlobalStateKey<uint64>({ key: 'total_stake' });

  supply = GlobalStateKey<uint64>({ key: 'supply' });

  peg_ratio = GlobalStateKey<uint64>({ key: 'peg_ratio' });

  token_id = GlobalStateKey<AssetID>({ key: 'token_id' });

  idle_stake = GlobalStateKey<uint64>({ key: 'idle_stake' });

  highest_bidder = GlobalStateKey<Address>({ key: 'highest_bidder' });

  burn_queue = GlobalStateKey<StaticArray<Address, 5>>({ key: 'burn_queue' });

  exhausted = GlobalStateKey<uint64>({ key: 'exhausted' });

  operator_to_validator_map = BoxMap<Address, Address>({ prefix: 'o_to_v_' });

  validator = BoxMap<Address, Validator>({ prefix: 'v_' });

  createApplication(): void {
    this.manager.value = this.txn.sender;
    this.protocol_fee.value = PROTOCOL_COMMISSION;
    this.total_stake.value = 0;
    this.peg_ratio.value = 1 * SCALE;
    this.token_id.value = AssetID.zeroIndex;
    this.idle_stake.value = 0;
    this.highest_bidder.value = Address.zeroAddress;
    this.burn_queue.value = [];
    this.exhausted.value = globals.round;
  }

  updateApplication(): void {
    assert(this.txn.sender === this.manager.value);
  }

  init_token(): void {
    assert(this.token_id.value === AssetID.zeroIndex, 'Token already initialized');
    this.token_id.value = sendAssetCreation({
      configAssetTotal: 10 ** 16,
      configAssetDecimals: 6,
      configAssetReserve: this.app.address,
      configAssetManager: this.app.address,
      configAssetClawback: globals.zeroAddress,
      configAssetFreeze: globals.zeroAddress,
      configAssetDefaultFrozen: 0,
      configAssetName: 'Equilibrium ALGO',
      configAssetUnitName: 'eALGO',
      configAssetURL: '',
    });
  }

  mint(mintTxn: PayTxn): void {
    verifyPayTxn(mintTxn, {
      sender: this.txn.sender,
      receiver: this.app.address,
      amount: { greaterThanEqualTo: ALGORAND_BASE_FEE },
    });
    sendAssetTransfer({
      assetReceiver: this.txn.sender,
      xferAsset: this.token_id.value,
      assetAmount: this.get_mint_amount(mintTxn.amount),
    });
    this.up_counters(mintTxn.amount, this.get_mint_amount(mintTxn.amount));
    this.idle_stake.value += mintTxn.amount;
  }

  burn(burnTxn: AssetTransferTxn): void {
    // TODO: RECHECK
    verifyAssetTransferTxn(burnTxn, {
      assetReceiver: this.app.address,
      xferAsset: this.token_id.value,
      assetAmount: { greaterThanEqualTo: ALGORAND_BASE_FEE },
    });
    assert(this.txn.sender === burnTxn.assetSender, 'Burn transaction sender mismatch');
    const burn_amount = this.get_burn_amount(burnTxn.assetAmount);
    let burned = 0; // Algo amount burn counter

    // check if there are Algo in idle balance to use
    if (this.idle_stake.value > 0) {
      let amount_from_idle = 0;
      if (this.idle_stake.value >= burn_amount) {
        this.idle_stake.value -= burn_amount;
        burned = burn_amount;
        amount_from_idle = burn_amount;
      } else {
        burned = this.idle_stake.value;
        this.idle_stake.value = 0;
        amount_from_idle = burned;
      }
      sendPayment({
        receiver: this.txn.sender,
        amount: amount_from_idle,
      });
      const from_idle = this.get_burn_amount(amount_from_idle);
      this.down_counters(amount_from_idle, from_idle);
    }

    if (this.exhausted.value === globals.round && !this.queue_is_full()) {
      return;
    }

    if (burned !== burn_amount) {
      const queue = clone(this.burn_queue.value);
      for (let i = 0; i < queue.length; i += 1) {
        if (queue[i] !== Address.zeroAddress && burned !== burn_amount) {
          const delegated = this.validator(queue[i]).value.delegated;
          const to_burn = burn_amount - burned;
          let burning_from_i = 0;
          if (delegated >= to_burn) {
            this.validator(queue[i]).value.delegated -= to_burn;
            burned += to_burn;
            burning_from_i = to_burn;
          } else {
            burning_from_i = delegated;
            this.validator(queue[i]).value.delegated = 0;
            queue[i] = Address.zeroAddress;
            burned += delegated;
          }
          if (burning_from_i > 0) {
            sendPayment({
              sender: queue[i],
              receiver: this.txn.sender,
              amount: burning_from_i,
            });
          }
        }
      }
      const amount_in_lst = this.get_burn_amount(burned);
      this.down_counters(burned, amount_in_lst);
      this.burn_queue.value = queue;
      if (amount_in_lst > 0) {
        sendAssetTransfer({
          assetSender: this.txn.sender,
          assetReceiver: this.app.address,
          xferAsset: this.token_id.value,
          assetAmount: burnTxn.assetAmount - amount_in_lst,
        });
        this.exhausted.value = globals.round;
      }
    }
  }

  snitch(validator: Address): void {
    assert(this.validator(validator).exists, 'Validator does not exist');
    const queue = clone(this.burn_queue.value);
    let minValidator: Address = validator;
    for (let i = 0; i < queue.length; i += 1) {
      if (queue[i] === Address.zeroAddress) {
        queue[i] = validator;
        break;
      }
      if (this.validator(queue[i]).value.buffer < this.validator(minValidator).value.buffer) {
        const temp = queue[i];
        queue[i] = minValidator;
        minValidator = temp;
      }
    }
    this.burn_queue.value = queue;
  }

  bid(bidding: Address): void {
    assert(this.validator(bidding).exists, 'Bidding address is not a validator');
    assert(this.validator(bidding).value.status === NEUTRAL_STATUS, 'Validator is not delegatable');

    const challenger = this.validator(bidding).value;

    if (this.highest_bidder.value === Address.zeroAddress) {
      this.highest_bidder.value = bidding;
    } else {
      const current_bidder = clone(this.validator(this.highest_bidder.value).value);
      if (current_bidder.buffer < challenger.buffer) {
        this.highest_bidder.value = bidding;
      }
    }
  }

  delegate(amount: uint64): void {
    sendPayment({
      receiver: this.highest_bidder.value,
      amount: amount,
    });
    this.idle_stake.value -= amount;
  }

  spawn_validator(mbr: PayTxn): void {
    verifyPayTxn(mbr, {
      receiver: this.app.address,
      amount: VALIDATOR_POOL_MBR + ALGORAND_BASE_FEE,
    });

    assert(this.operator_to_validator_map(this.txn.sender).exists === false, 'Operator already has a validator');

    const validator_address = sendMethodCall<typeof Puppet.prototype.spawn>({
      onCompletion: OnCompletion.DeleteApplication,
      approvalProgram: Puppet.approvalProgram(),
      clearStateProgram: Puppet.clearProgram(),
    });

    sendPayment({
      receiver: validator_address,
      amount: MBR_OPT_IN + ALGORAND_BASE_FEE,
    });

    sendAssetTransfer({
      assetSender: validator_address,
      assetReceiver: validator_address,
      xferAsset: this.token_id.value,
      assetAmount: 0,
    });

    this.operator_to_validator_map(this.txn.sender).value = validator_address;
    this.validator(validator_address).value = {
      operator: this.txn.sender,
      commit: 0,
      yielded: 0,
      delegated: 0,
      performance: 0,
      buffer: BUFFER_MAX,
      status: NOT_DELEGATABLE_STATUS,
      last_block: 0,
      last_report: 0,
      delinquency: 0,
    };
  }

  operator_commit(commitTxn: PayTxn): void {
    verifyPayTxn(commitTxn, {
      receiver: this.operator_to_validator_map(this.txn.sender).value,
      amount: { greaterThanEqualTo: ALGORAND_BASE_FEE },
    });
    const lst_amount = this.get_mint_amount(commitTxn.amount);
    sendAssetTransfer({
      assetAmount: lst_amount,
      assetReceiver: this.operator_to_validator_map(this.txn.sender).value,
      xferAsset: this.token_id.value,
    });
    this.up_counters(commitTxn.amount, lst_amount);
    const validator = this.operator_to_validator_map(this.txn.sender).value;
    const validator_info = this.validator(validator).value;
    validator_info.commit += commitTxn.amount;
    validator_info.buffer = this.re_buffer(validator);
  }

  operator_unstake(amount: uint64): void {
    // amount is in LST
    // turn the LST amount into ALGO w.r.t. peg ratio
    const algo_amount = this.get_burn_amount(amount);
    const val = this.operator_to_validator_map(this.txn.sender).value;
    const val_info = clone(this.validator(val).value);
    val_info.commit -= algo_amount;
    assert(
      val_info.commit > globals.payoutsMinBalance,
      'must keep enough Algo to remain above the minimum balance threshold for payouts'
    );
    sendPayment({
      sender: val,
      receiver: this.txn.sender,
      amount: algo_amount,
    });
    sendAssetTransfer({
      assetSender: val,
      assetReceiver: this.app.address,
      assetAmount: amount,
      xferAsset: this.token_id.value,
    });
    this.re_buffer(val);
    this.down_counters(algo_amount, amount);
  }

  go_online(
    fee_payment: PayTxn,
    vote_PK: bytes,
    selection_PK: bytes,
    state_proof_PK: bytes,
    vote_first: uint64,
    vote_last: uint64,
    vote_key_dilution: uint64
  ): void {
    assert(this.operator_to_validator_map(this.txn.sender).exists, 'Operator does not have a validator');
    const validator_address = this.operator_to_validator_map(this.txn.sender).value;
    verifyPayTxn(fee_payment, {
      receiver: validator_address,
      amount: this.get_online_fee(),
    });

    assert(
      validator_address.balance >= globals.payoutsMinBalance && validator_address.balance <= MAX_STAKE_PER_ACCOUNT
    );

    sendOnlineKeyRegistration({
      sender: validator_address,
      votePK: vote_PK,
      selectionPK: selection_PK,
      stateProofPK: state_proof_PK,
      voteFirst: vote_first,
      voteLast: vote_last,
      voteKeyDilution: vote_key_dilution,
      fee: fee_payment.amount,
    });

    const val_info = clone(this.validator(validator_address).value);

    if (val_info.status === NOT_DELEGATABLE_STATUS) {
      val_info.status = NEUTRAL_STATUS;
    }
    this.validator(validator_address).value = val_info;
  }

  go_offline(): void {
    assert(this.operator_to_validator_map(this.txn.sender).exists, 'Operator does not have a validator');
    const validator_address = this.operator_to_validator_map(this.txn.sender).value;
    sendOfflineKeyRegistration({
      sender: validator_address,
    });
    this.validator(validator_address).value.status = NOT_DELEGATABLE_STATUS;
  }

  report_block(block: uint64): void {
    const proposer = blocks[block].proposer;
    assert(this.validator(proposer).exists, 'proposer is not a recognized validator');
    const report = blocks[block].proposerPayout;
    const validator = clone(this.validator(proposer).value);
    assert(block > validator.last_report, 'this block is older than the last reported');
    const report_time = globals.round - block < OPERATOR_REPORT_MAX_TIME;
    const keep_fee = wideRatio([report, VALIDATOR_COMMISSION], [100]);
    if (this.expected_performance(proposer.voterBalance) > globals.round - proposer.lastProposed)
      validator.performance += 1;

    const receiver = report_time ? validator.operator : this.txn.sender;

    sendPayment({
      sender: proposer,
      receiver: receiver,
      amount: keep_fee,
    });
    validator.delinquency = 0;
    validator.last_report = block;
    this.validator(proposer).value = validator;
  }

  stake_dust(account: Address): void {
    let dust: uint64 = 0;
    if (account === this.app.address) {
      dust = this.app.address.balance - this.idle_stake.value - this.app.address.minBalance;
      this.up_counters(dust, 0);
    } else if (this.validator(account).exists) {
      const val_info = this.validator(account).value;
      dust = account.balance - val_info.commit - val_info.delegated - account.minBalance;
      if (dust > 0) {
        this.up_counters(dust, 0);
        val_info.delegated += dust;
        this.validator(account).value = val_info;
      }
    }
  }

  report_delinquency(): void {
    // check delinquency values: stake amount, last block etc.
    // set status to DELINQUENT || increment delinquency counter
  }

  solve_delinquency(): void {}

  close_validator(val: Address): void {
    // check sender is the operator of the validator
    // check that the validator is not delinquent
    // send all Algo to idle stake
    // send all LST to operator
    // delete validator from map & closeout account
    this.cleanup_on_delete(val);
  }

  private get_online_fee(): uint64 {
    if (!this.app.address.incentiveEligible) {
      return globals.payoutsGoOnlineFee;
    }
    return 0;
  }

  private get_peg(): void {
    if (this.supply.value === 0) {
      return;
    }
    this.peg_ratio.value = wideRatio([this.total_stake.value, SCALE], [this.supply.value]);
  }

  private get_mint_amount(amount: uint64): uint64 {
    this.get_peg();
    return wideRatio([amount, SCALE], [this.peg_ratio.value]);
  }

  private get_burn_amount(amount: uint64): uint64 {
    this.get_peg();
    return wideRatio([amount, this.peg_ratio.value], [SCALE]);
  }

  private up_counters(stake: uint64, supply: uint64): void {
    this.total_stake.value += stake;
    this.supply.value += supply;
    this.get_peg();
  }

  private down_counters(stake: uint64, supply: uint64): void {
    assert(this.total_stake.value >= stake && this.supply.value >= supply, 'Counters cannot go below zero');
    this.total_stake.value -= stake;
    this.supply.value -= supply;
    this.get_peg();
  }

  private cleanup_on_delete(to_cleanup: Address): void {
    if (this.highest_bidder.value === to_cleanup) {
      this.highest_bidder.value = Address.zeroAddress;
    }
    const queue = clone(this.burn_queue.value);
    for (let i = 0; i < queue.length; i += 1) {
      if (queue[i] === to_cleanup) {
        queue[i] = Address.zeroAddress;
        break;
      }
    }
    this.burn_queue.value = queue;
  }

  private re_buffer(validator: Address): uint64 {
    const val_info = this.validator(validator).value;
    const max = val_info.commit + PERFORMANCE_STAKE_INCREASE * (val_info.performance / PERFORMANCE_STEP);
    return (val_info.delegated * BUFFER_MAX) / max;
  }

  private queue_is_full(): boolean {
    const queue = clone(this.burn_queue.value);
    for (let i = 0; i < queue.length; i += 1) {
      if (queue[i] === Address.zeroAddress) {
        return false;
      }
    }
    return true;
  }

  private expected_performance(stake: uint64): uint64 {
    return onlineStake() / stake;
  }

  private tolerated_performance(expected: uint64): uint64 {
    return expected * 2;
  }
}
