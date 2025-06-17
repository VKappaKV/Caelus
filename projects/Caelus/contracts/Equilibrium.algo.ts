/* eslint-disable camelcase */
import { Contract } from '@algorandfoundation/tealscript';
import {
  ALGORAND_BASE_FEE,
  MAX_STAKE_PER_ACCOUNT,
  MBR_OPT_IN,
  NEUTRAL_STATUS,
  NOT_DELEGATABLE_STATUS,
  PROTOCOL_COMMISSION,
  SCALE,
  VALIDATOR_POOL_MBR,
} from './constants.algo';
import { Puppet } from './Puppet.algo';

interface Validator {
  commit: uint64;
  yielded: uint64;
  delegated: uint64;
  performance: uint64;
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

  operator_to_validator_map = BoxMap<Address, Address>();

  validator = BoxMap<Address, Validator>();

  createApplication(): void {
    this.manager.value = this.txn.sender;
    this.protocol_fee.value = PROTOCOL_COMMISSION;
    this.total_stake.value = 0;
    this.peg_ratio.value = 1 * SCALE;
    this.token_id.value = AssetID.zeroIndex;
    this.idle_stake.value = 0;
    this.highest_bidder.value = Address.zeroAddress;
    this.burn_queue.value = [];
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

  mint(): void {}

  burn(): void {}

  snitch(): void {}

  bid(): void {}

  delegate(): void {}

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
      commit: 0,
      yielded: 0,
      delegated: 0,
      performance: 0,
      status: NOT_DELEGATABLE_STATUS,
      last_block: 0,
      last_report: 0,
      delinquency: 0,
    };
  }

  operator_commit(commitTxn: PayTxn): void {
    // Txn -> validator address
    // Send LST with equivalent value to commit w.r.t. peg ratio
    // Update values
  }

  operator_unstake(amount: uint64): void {
    // amount is in LST
    // turn the LST amount into ALGO w.r.t. peg ratio
    // send LST to operator
    // move Algo amount into idle stake
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

  report_block(): void {}

  report_delinquency(): void {
    // check delinquency values: stake amount, last block etc.
    // set status to DELINQUENT || increment delinquency counter
  }

  solve_delinquency(): void {}

  close_validator(): void {
    // check sender is the operator of the validator
    // check that the validator is not delinquent
    // send all Algo to idle stake
    // send all LST to operator
    // delete validator from map & closeout account
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
}
