import { Contract } from '@algorandfoundation/tealscript';
import { MAX_ALGO_STAKE_PER_ACCOUNT, MIN_ALGO_STAKE_FOR_REWARDS } from './constants.algo';

/**
 * Caelus Validator Pool Contract.
 */

export class CaelusValidatorPool extends Contract {
  /**
   * Contract State Key
   */
  programVersion = 11;

  creatorContract_AppID = GlobalStateKey<AppID>({ key: 'creator' });

  algod_version = GlobalStateKey<bytes>({ key: 'algodVersion' });

  validatorPoolContract_version = GlobalStateKey<uint64>({ key: 'contractVersion' });

  operator_Address = GlobalStateKey<Address>({ key: 'operator' });

  operator_Commit = GlobalStateKey<uint64>({ key: 'operatorCommit' });

  min_Commit = GlobalStateKey<uint64>({ key: 'minStake' });

  delegated_stake = GlobalStateKey<uint64>({ key: 'delegatedStake' });

  max_delegatable_stake = GlobalStateKey<uint64>({ key: 'max_dStake' });

  saturation_BUFFER = GlobalStateKey<uint64>({ key: 'saturationBuffer' });

  /**
   * Public Methods
   */

  /**
   * createApplication method called at creation, initializes some globalKey values
   * @param {AppID} creatingContract - ApplicationID for the creator contract (CaelusAdminContract)
   * @param {Address} operatorAddress - Address of the node operator used to sign online/offline txns and participate in auctions
   */
  createApplication(creatingContract: AppID, operatorAddress: Address): void {
    this.min_Commit.value = MIN_ALGO_STAKE_FOR_REWARDS;
    this.creatorContract_AppID.value = creatingContract;
    this.operator_Address.value = operatorAddress;

    // stake counters
    this.delegated_stake.value = 0;
    this.max_delegatable_stake.value = 0;
    this.operator_Commit.value = 0;

    // init buffer
    this.saturation_BUFFER.value = 0;
  }

  /**
   *  Used by the node operator to update his stake amount for the node
   *
   * @param {PayTxn} commit - node operator stake commitment
   * @throws Error if the sender isn't the node operator, the receiver isn't the app address or if the total balance is above 30M Algo
   */
  updateAddToOperatorCommit(commit: PayTxn): void {
    const totalBalanceUpdated = this.operator_Commit.value + commit.amount;
    assert(totalBalanceUpdated < MAX_ALGO_STAKE_PER_ACCOUNT, 'Contract max balance cannot be over 30M Algo');

    verifyPayTxn(commit, {
      sender: this.operator_Address.value,
      receiver: this.app.address,
      amount: commit.amount,
    });
    this.operator_Commit.value += commit.amount;
    this.updateDelegationFactors();
  }

  /**
   *
   * @param {uint64} claimRequest - amount claimed by the node operator to be removed from the contract balance and subtracted from the operator_commit counter
   * @throws Error if the sender isn't the node operator or if the total commit by the node operator goes below the min threshold for rewards eligibility
   */
  updateRemoveFromOperatorCommit(claimRequest: uint64): void {
    assert(this.txn.sender === this.operator_Address.value, 'Only the Node Operator can claim his stake');
    assert(
      this.operator_Commit.value - claimRequest > MIN_ALGO_STAKE_FOR_REWARDS,
      'Node Operator can take his stake below 30k only if the node contract will be closed'
    );
    sendPayment({
      sender: this.app.address,
      receiver: this.operator_Address.value,
      amount: claimRequest,
      fee: 0,
    });
    this.updateDelegationFactors();
  }

  /**
   * Used to set the Contract account online for consensus. Always check that account is online and incentivesEligible before having delegatable stake
   *
   * @param {PayTxn} feePayment - Payment transaction to the contract to cover costs for Eligibility fee; 0 for renewal.
   * @param {bytes} votePK - The vote public key
   * @param {bytes} selectionPK - The selection public key
   * @param {bytes} stateProofPK - the state proof public key
   * @param {uint64} voteFirst - Index of first valid block for the participation keys
   * @param {uint64} voteLast - Index of last valid block for for the participation keys
   * @param {uint64} voteKeyDilution - The vote key dilution value
   * @throws {Error} throws error if the caller isn't the node operator
   */
  goOnline(
    feePayment: PayTxn,
    votePK: bytes,
    selectionPK: bytes,
    stateProofPK: bytes,
    voteFirst: uint64,
    voteLast: uint64,
    voteKeyDilution: uint64
  ): void {
    // Check that sender is the node operator
    assert(
      this.txn.sender === this.operator_Address.value,
      'Only the Node Operator can register online with participation key'
    );

    // Check that contract balance is at least 30k Algo
    assert(
      this.app.address.balance >= MIN_ALGO_STAKE_FOR_REWARDS,
      'Contract needs 30k Algo as minimum balance for rewards eligibility'
    );

    // Check that operator commit to the contract balance is at least 30k Algo
    assert(
      this.operator_Commit.value >= this.min_Commit.value,
      'Operator commit must be higher than minimum balance for rewards eligibility'
    );

    const extraFee = this.getGoOnlineFeeAmount();

    verifyPayTxn(feePayment, { receiver: this.app.address, amount: extraFee });

    sendOnlineKeyRegistration({
      votePK: votePK,
      selectionPK: selectionPK,
      stateProofPK: stateProofPK,
      voteFirst: voteFirst,
      voteLast: voteLast,
      voteKeyDilution: voteKeyDilution,
      fee: extraFee,
    });
  }

  /**
   * Set the contract account to offline so that it doesn't participate in consensus anymore.
   * if graceful then it only means that there was some migration or other operation [CASE 1]
   * if used to force the account offline because of bad behavior, then set up a flag for penalties [CASE 2]
   *
   * @param {uint64} offlineCase - {0}: graceful offline of the node by the node runner or the main Caelus contract
   *                              {1}: node is misbehaving and needs to be set offline by the main Caelus contract
   */
  goOffline(offlineCase: uint64): void {
    assert(
      this.txn.sender === this.operator_Address.value || this.txn.sender === this.creatorContract_AppID.value.address,
      'Only Node Operator or Caelus Admin contract can set the contract offline'
    );

    if (offlineCase === 0) {
      sendOfflineKeyRegistration({});
    }

    if (offlineCase === 1) {
      assert(
        this.txn.sender === this.creatorContract_AppID.value.address,
        'Only the Caelus main contract can set the contract offline and issue a penalty'
      );
      // ... handle penalty for node operator
      sendOfflineKeyRegistration({});
    }
  }

  /**
   * Private Methods
   */

  private getGoOnlineFeeAmount(): uint64 {
    if (!this.getEligibilityFlag) {
      return globals.payoutsGoOnlineFee;
    }
    return 0;
  }

  private getEligibilityFlag(): boolean {
    return this.app.address.incentiveEligible;
  }

  private updateDelegationFactors(): void {
    this.max_delegatable_stake.value =
      this.operator_Commit.value > MIN_ALGO_STAKE_FOR_REWARDS ? this.operator_Commit.value : 0;

    this.saturation_BUFFER.value =
      this.max_delegatable_stake.value > 0 ? this.delegated_stake.value / this.max_delegatable_stake.value : 1;
  }
}
