/* eslint-disable camelcase */
import { Contract } from '@algorandfoundation/tealscript';
import { NOT_DELEGATABLE_STATUS, PROTOCOL_COMMISSION, SCALE, VALIDATOR_POOL_MBR } from './constants.algo';
import { Puppet } from './ValidatorPuppet.algo';

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

  spawnValidator(mbr: PayTxn): void {
    verifyPayTxn(mbr, {
      receiver: this.app.address,
      amount: VALIDATOR_POOL_MBR,
    });

    const validator_address = sendMethodCall<typeof Puppet.prototype.spawn>({
      onCompletion: OnCompletion.DeleteApplication,
      approvalProgram: Puppet.approvalProgram(),
      clearStateProgram: Puppet.clearProgram(),
    });

    sendPayment({
      receiver: validator_address,
      amount: 100_000,
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
}
