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
  DELINQUENCY_STATUS,
  ACCOUNT_MIN_BALANCE,
  BURN_QUEUE_MBR,
  BURN_QUEUE_LENGTH,
} from './constants.algo';
import { Puppet } from './Puppet.algo';

interface Validator {
  operator: Address; // operator address
  commit: uint64; // amount of Algo the operator has committed
  yielded: uint64; // amount of Algo the validator has yielded as rewards
  delegated: uint64; // amount of Algo the validator has received as delegation
  performance: uint64; // performance score
  buffer: uint64; // buffer score: delegated/max
  status: uint64; // NEUTRAL_STATUS | NOT_DELEGATABLE_STATUS | DELINQUENCY_STATUS
  last_block: uint64; // last block the validator has proposed
  last_report: uint64; // last successful delinquency report
  delinquency: uint64; // delinquency score
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

  burn_queue = BoxKey<StaticArray<Address, typeof BURN_QUEUE_LENGTH>>({ key: 'burn_queue' });

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
    this.exhausted.value = globals.round;
  }

  updateApplication(): void {
    assert(this.txn.sender === this.manager.value);
  }

  init(mbr: PayTxn): void {
    verifyPayTxn(mbr, {
      receiver: this.app.address,
      amount: { greaterThanEqualTo: MBR_OPT_IN + ACCOUNT_MIN_BALANCE + BURN_QUEUE_MBR },
    });
    assert(this.token_id.value === AssetID.zeroIndex, 'Token already initialized');
    assert(this.burn_queue.exists === false, 'Burn queue already initialized');
    this.burn_queue.create();
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

    const lst_amount = this.get_mint_amount(mintTxn.amount);

    sendAssetTransfer({
      assetReceiver: this.txn.sender,
      xferAsset: this.token_id.value,
      assetAmount: lst_amount,
    });
    this.up_counters(mintTxn.amount, lst_amount);
    this.idle_stake.value += mintTxn.amount;
  }

  burn(burnTxn: AssetTransferTxn): void {
    verifyAssetTransferTxn(burnTxn, {
      assetSender: this.txn.sender,
      assetReceiver: this.app.address,
      xferAsset: this.token_id.value,
      assetAmount: { greaterThanEqualTo: ALGORAND_BASE_FEE },
    });
    let burn_amount = this.get_burn_amount(burnTxn.assetAmount); // Algo amount to burn from LST amount
    let burned = 0; // Algo amount burn counter
    let from_idle = 0;
    let from_delegation = 0;

    // check if there are Algo in idle balance to use
    if (this.idle_stake.value > 0) {
      if (this.idle_stake.value >= burn_amount) {
        this.idle_stake.value -= burn_amount;
        burned = burn_amount;
      } else {
        burned = this.idle_stake.value;
        this.idle_stake.value = 0;
      }
      sendPayment({
        receiver: this.txn.sender,
        amount: burned,
      });
      from_idle = this.get_mint_amount(burned); // LST amount equivalent to burned Algo from idle
      this.down_counters(burned, from_idle);
    }

    if (burned === burn_amount) {
      return;
    }

    burn_amount -= burned; // remaining amount to burn
    burned = 0; // reset burned counter for delegation burning

    // if we have already exhausted by burn from delegation in this round, and the burn queue is not full, skip burning from delegation
    if (this.exhausted.value === globals.round && !this.queue_is_full()) {
      return;
    }

    const queue = clone(this.burn_queue.value);
    for (let i = 0; i < queue.length; i += 1) {
      if (burned >= burn_amount) {
        break;
      }
      const validator_address = queue[i];
      if (validator_address === Address.zeroAddress) continue;
      const validator_i = clone(this.validator(queue[i]).value);
      if (queue[i] !== Address.zeroAddress && burned < burn_amount) {
        const delegated = validator_i.delegated;
        const to_burn = burn_amount - burned;
        let burning_from_i = 0;
        if (delegated >= to_burn) {
          validator_i.delegated -= to_burn;
          burned += to_burn;
          burning_from_i = to_burn;
        } else {
          burning_from_i = delegated;
          validator_i.delegated = 0;
          queue[i] = Address.zeroAddress;
          burned += delegated;
        }
        if (burning_from_i > 0) {
          sendPayment({
            sender: validator_address,
            receiver: this.txn.sender,
            amount: burning_from_i,
          });
          this.validator(validator_address).value = validator_i;
        }
      }
    }
    from_delegation = this.get_mint_amount(burned); // LST amount equivalent to burned Algo from delegation
    if (burned === burn_amount) {
      assert(from_idle + from_delegation <= burnTxn.assetAmount, 'Burn amounts do not match, calculation error'); // SANITY CHECK
    }
    this.down_counters(burned, from_delegation);
    this.burn_queue.value = queue;
    if (from_delegation + from_idle < burnTxn.assetAmount) {
      sendAssetTransfer({
        assetReceiver: this.txn.sender,
        xferAsset: this.token_id.value,
        assetAmount: burnTxn.assetAmount - from_delegation - from_idle,
      });
      this.exhausted.value = globals.round; // if we couldn't burn the full amount, set exhausted to current round, the burn queue needs to be populated again
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
    /* FOR MAINNET TO BE UNCOMMENTED.
    if (this.highest_bidder.value !== Address.zeroAddress) {
      assert(this.validator(bidding).value.performance >= 5, 'Validator performance is too low to bid');
    }
    */
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
    assert(this.highest_bidder.value !== Address.zeroAddress, 'No highest bidder to delegate to');
    assert(this.idle_stake.value >= amount, 'Not enough idle stake to delegate');
    sendPayment({
      receiver: this.highest_bidder.value,
      amount: amount,
    });
    this.validator(this.highest_bidder.value).value.delegated += amount;
    this.idle_stake.value -= amount;
  }

  spawn_validator(mbr: PayTxn): void {
    verifyPayTxn(mbr, {
      receiver: this.app.address,
      amount: { greaterThanEqualTo: VALIDATOR_POOL_MBR + ALGORAND_BASE_FEE },
    });

    assert(this.operator_to_validator_map(this.txn.sender).exists === false, 'Operator already has a validator');

    const validator_address = sendMethodCall<typeof Puppet.prototype.spawn>({
      onCompletion: OnCompletion.DeleteApplication,
      approvalProgram: Puppet.approvalProgram(),
      clearStateProgram: Puppet.clearProgram(),
    });

    /**
     * Fund the validator to cover minimum balance for account creation and opt-in
     */
    sendPayment({
      receiver: validator_address,
      amount: MBR_OPT_IN + ACCOUNT_MIN_BALANCE,
    });

    sendAssetTransfer({
      sender: validator_address,
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
    assert(this.operator_to_validator_map(this.txn.sender).exists);
    const validator = this.operator_to_validator_map(this.txn.sender).value;
    verifyPayTxn(commitTxn, {
      receiver: this.app.address,
      amount: { greaterThanEqualTo: ALGORAND_BASE_FEE },
    });
    const lst_amount = this.get_mint_amount(commitTxn.amount);
    sendPayment({
      receiver: validator,
      amount: commitTxn.amount,
    });
    sendAssetTransfer({
      assetAmount: lst_amount,
      assetReceiver: validator,
      xferAsset: this.token_id.value,
    });
    this.up_counters(commitTxn.amount, lst_amount);
    const validator_info = clone(this.validator(validator).value);
    validator_info.commit += commitTxn.amount;
    validator_info.buffer = this.re_buffer(validator);
    this.validator(validator).value = validator_info;
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
      sender: val,
      assetReceiver: this.app.address,
      assetAmount: amount,
      xferAsset: this.token_id.value,
    });
    val_info.buffer = this.re_buffer(val);
    this.validator(val).value = val_info;
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
      receiver: this.app.address,
      amount: this.get_online_fee(),
    });

    assert(
      validator_address.balance >= globals.payoutsMinBalance && validator_address.balance <= MAX_STAKE_PER_ACCOUNT
    );
    sendPayment({
      receiver: validator_address,
      amount: fee_payment.amount,
    });
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
      this.idle_stake.value += dust;
    } else if (this.validator(account).exists) {
      const val_info = clone(this.validator(account).value);
      dust = account.balance - val_info.commit - val_info.delegated - account.minBalance;
      if (dust > 0) {
        this.up_counters(dust, 0);
        val_info.delegated += dust;
        this.validator(account).value = val_info;
      }
    }
  }

  check_delinquency(validator: Address): void {
    assert(this.validator(validator).exists, 'Validator does not exist');
    // check delinquency values: stake amount, last block etc.
    // set status to DELINQUENT || increment delinquency counter
    // save report block in last report
  }

  solve_delinquency(block: uint64, validator: Address): void {
    assert(this.validator(validator).exists, 'Validator does not exist');
    const val_info = clone(this.validator(validator).value);
    assert(val_info.status === DELINQUENCY_STATUS, 'Validator is not delinquent');
    assert(block > val_info.last_report, 'Block must be more recent than last report');
    assert(blocks[block].proposer === validator, 'Validator did not propose the given block');

    if (val_info.last_report > block) {
      return;
    }

    if (val_info.delinquency > 1) {
      val_info.delinquency -= 1;
    } else {
      val_info.delinquency = 0;
      val_info.status = NEUTRAL_STATUS;
    }

    // fetch validator info
    // check last delinquent report block
    // if block > last report block abbassa delinquency score
    // if score is 0, set status to NEUTRAL_STATUS
  }

  close_validator(validator: Address): void {
    // check sender is the operator of the validator
    // check that the validator is not delinquent
    // send all Algo to idle stake
    // send all LST to operator
    // delete validator from map & closeout account

    assert(this.txn.sender === this.validator(validator).value.operator, 'Only operator can close the validator');
    assert(this.validator(validator).value.status !== DELINQUENCY_STATUS, 'Cannot close a delinquent validator');
    const lst_balance = validator.assetBalance(this.token_id.value);
    const sweep = validator.balance - validator.minBalance;
    sendAssetTransfer({
      sender: validator,
      assetReceiver: this.txn.sender,
      xferAsset: this.token_id.value,
      assetAmount: lst_balance,
    });
    sendPayment({
      sender: validator,
      receiver: this.app.address,
      amount: sweep,
      closeRemainderTo: this.app.address,
    });
    this.idle_stake.value += sweep;
    this.cleanup_on_delete(validator);
    this.operator_to_validator_map(this.txn.sender).delete();
    this.validator(validator).delete();
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

  private get_max(info: Validator): uint64 {
    const max = info.commit + PERFORMANCE_STAKE_INCREASE * (info.performance / PERFORMANCE_STEP);
    const penalty = info.delinquency * PERFORMANCE_STAKE_INCREASE;
    if (max < penalty) {
      return 0;
    }
    return max - penalty;
  }

  private re_buffer(validator: Address): uint64 {
    const val_info = this.validator(validator).value;
    const max = this.get_max(val_info);
    if (max === 0) {
      return BUFFER_MAX;
    }
    return (val_info.delegated * BUFFER_MAX) / max;
  }

  private queue_is_full(): boolean {
    const queue = this.burn_queue.value;
    for (let i = 0; i < queue.length; i += 1) {
      if (queue[i] === Address.zeroAddress) {
        return false;
      }
    }
    return true;
  }

  private expected_performance(stake: uint64): uint64 {
    if (stake === 0) {
      return 0;
    }
    return onlineStake() / stake;
  }

  private tolerated_performance(expected: uint64): uint64 {
    return expected * 2;
  }

  get_validator(operator: Address): Address {
    return this.operator_to_validator_map(operator).value;
  }

  get_validator_info(validator: Address): Validator {
    return this.validator(validator).value;
  }
}
