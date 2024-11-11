import { Contract } from '@algorandfoundation/tealscript';
import { MAX_ALGO_STAKE_PER_ACCOUNT, MIN_ALGO_STAKE_FOR_REWARDS, PERFORMANCE_STAKE_INCREASE } from './constants.algo';

/**
 * Caelus Validator Pool Contract.
 */

export class CaelusValidatorPool extends Contract {
  /** ***************
   * Contract State *
   **************** */
  programVersion = 11;

  // Contract checks params

  creatorContract_AppID = GlobalStateKey<AppID>({ key: 'creator' });

  algod_version = GlobalStateKey<string>({ key: 'algodV' });

  pool_name = GlobalStateKey<string>({ key: 'name' });

  validatorPoolContract_version = GlobalStateKey<uint64>({ key: 'contractVersion' });

  // Operator specific params

  operator_Address = GlobalStateKey<Address>({ key: 'operator' });

  operator_Commit = GlobalStateKey<uint64>({ key: 'operatorCommit' });

  min_Commit = GlobalStateKey<uint64>({ key: 'minStake' });

  // Delegated Stake params

  delegated_stake = GlobalStateKey<uint64>({ key: 'delegatedStake' });

  max_delegatable_stake = GlobalStateKey<uint64>({ key: 'maxDStake' });

  // Node performance params

  performance_counter = GlobalStateKey<uint64>({ key: 'performance' });

  saturation_BUFFER = GlobalStateKey<uint64>({ key: 'saturationBuffer' }); // value goes from 0 to 1000

  last_reward_report = GlobalStateKey<uint64>({ key: 'rewardReport' });

  isDelinquent = GlobalStateKey<boolean>({ key: 'isDelinquent' });

  last_delinquency_report = GlobalStateKey<uint64>({ key: 'delinquencyReport' });

  //----------------------------------------------------------------------------------------------------------

  /** ******************
   * Public Methods    *
   ******************* */

  /**
   * createApplication method called at creation, initializes some globalKey values
   * @param {AppID} creatingContract - ApplicationID for the creator contract (CaelusAdminContract)
   * @param {Address} operatorAddress - Address of the node operator used to sign online/offline txns and participate in auctions
   * @param {uint64} contractVersion - Approval Program version for the node contract, stored in the CaelusAdminContract
   */
  createApplication(creatingContract: AppID, operatorAddress: Address, contractVersion: uint64): void {
    this.min_Commit.value = MIN_ALGO_STAKE_FOR_REWARDS;
    this.creatorContract_AppID.value = creatingContract;
    this.operator_Address.value = operatorAddress;
    this.validatorPoolContract_version.value = contractVersion;

    // stake counters
    this.operator_Commit.value = 0;
    this.delegated_stake.value = 0;
    this.max_delegatable_stake.value = 0;

    // init buffer, flags & counters
    this.saturation_BUFFER.value = 0;
    this.performance_counter.value = 0;
    this.isDelinquent.value = false;
  }

  /**
   *  Used by the node operator to add to his stake amount for the node
   *
   * @param {PayTxn} commit - node operator stake commitment
   * @throws {Error} if the sender isn't the node operator, the receiver isn't the app address or if the total balance is above 30M Algo
   */
  addToOperatorCommit(commit: PayTxn): void {
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
   *  Used by the node operator to remove from his stake amount for the node
   * @param {uint64} claimRequest - amount claimed by the node operator to be removed from the contract balance and subtracted from the operator_commit counter
   * @throws {Error} if the sender isn't the node operator or if the total commit by the node operator goes below the min threshold for rewards eligibility
   */
  removeFromOperatorCommit(claimRequest: uint64): void {
    verifyAppCallTxn(this.txn, {
      sender: this.operator_Address.value,
    });
    // assert(this.txn.sender === this.operator_Address.value, 'Only the Node Operator can claim his stake');
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

  // Todo
  // check where falls the last reported proposed block within the tolerated block delta
  performanceCheck(): void {}

  // calculate tolerated wait time given the online stake for this account vs total online stake
  getToleratedBlockDelta(): uint64 {
    return 0;
  }

  // report the proposed block and send the rewards to the rewards_reserve_address; keep the operator fee
  reportRewards(block: uint64): void {
    // call CaelusAdmin contract
    // use the block proposer to get performance++
    // use the proposerPayout to declare the amount
    const report = blocks[block].proposerPayout;
    const takeFee = (report * 6) / 100;
  }

  // call the auction contract to report the saturation buffer & delegatable stake
  bid(): void {}

  // called by the auction contract to assign stake to the node contract at mint
  add_stake(): void {}

  // call the auction contract to report the saturation buffer of itself or another validator contract
  snitch_burn(): void {}

  // call to check on performances throught the get_snitched method
  snitch(): void {}

  get_snitched(): void {}

  // used by CA contract to remove the delegated stake and send it back to the auction
  clawback_stake(): void {}

  // used by other CV contracts to claim stake in case of delinquent stake
  clawback_stake_to_validator(): void {}

  // used by CA to clean up remaining Algo
  claimLeftAlgo(): void {}

  // TODO in the future. Can we trustlessly check the algod version? Or does it need an oracle?
  checkAlgodVersion(): void {}

  /**
   * Used to set the Contract account online for consensus. Always check that account is online and incentivesEligible before having delegatable stake
   *
   * @param {PayTxn} feePayment - Payment transaction to the contract to cover costs for Eligibility fee; 0 for renewal.
   * @param {string} votePK - The vote public key
   * @param {string} selectionPK - The selection public key
   * @param {string} stateProofPK - the state proof public key
   * @param {uint64} voteFirst - Index of first valid block for the participation keys
   * @param {uint64} voteLast - Index of last valid block for for the participation keys
   * @param {uint64} voteKeyDilution - The vote key dilution value
   * @throws {Error} if the caller isn't the node operator
   */
  goOnline(
    feePayment: PayTxn,
    votePK: string,
    selectionPK: string,
    stateProofPK: string,
    voteFirst: uint64,
    voteLast: uint64,
    voteKeyDilution: uint64
  ): void {
    // Check that sender is the node operator
    /*     assert(
      this.txn.sender === this.operator_Address.value,
      'Only the Node Operator can register online with participation key'
    ); */
    /* verifyAppCallTxn(this.txn, {
      sender: this.operator_Address.value,
    }); */

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
    /* assert(
      this.txn.sender === this.operator_Address.value || this.txn.sender === this.creatorContract_AppID.value.address,
      'Only Node Operator or Caelus Admin contract can set the contract offline'
    ); */
    /* verifyAppCallTxn(this.txn, {
      sender: this.creatorContract_AppID.value.address || this.operator_Address.value,
    }); */

    if (offlineCase === 0) {
      sendOfflineKeyRegistration({});
    }

    if (offlineCase === 1) {
      /* assert(
        this.txn.sender === this.creatorContract_AppID.value.address,
        'Only the Caelus main contract can set the contract offline and issue a penalty'
      ); */
      verifyAppCallTxn(this.txn, {
        sender: this.creatorContract_AppID.value.address,
      });
      // if it's going to be set offline by the CaelusAdmin Contract might change penalty to just clawback every stake
      // directly and reset all the values to 0; with Delinquency max_delegatable_stake can't be recalculated to start
      // to the init node commit but only on performance for a certain number of blocks depending on the tolerated block delta
      this.performance_counter.value = 0;
      this.max_delegatable_stake.value = 0; // setting the contract to a state where it can get snitched from other contract or directly by a following txn appCall
      sendOfflineKeyRegistration({});
    }
  }

  // private or public?
  private updateDelegationFactors(): void {
    // start counting from the operator commit
    if (this.operator_Commit.value > MIN_ALGO_STAKE_FOR_REWARDS) {
      this.max_delegatable_stake.value = this.operator_Commit.value;
    } else {
      this.max_delegatable_stake.value = 0;
    }

    // add in the performance counter to increase delegatable amount
    this.max_delegatable_stake.value += PERFORMANCE_STAKE_INCREASE * (this.performance_counter.value / 5);

    // check against MAX_ALGO_STAKE_PER_ACCOUNT (50M)
    if (this.app.address.balance > MAX_ALGO_STAKE_PER_ACCOUNT) {
      this.max_delegatable_stake.value = 0;
    } else if (this.app.address.balance + this.max_delegatable_stake.value > MAX_ALGO_STAKE_PER_ACCOUNT) {
      this.max_delegatable_stake.value =
        this.app.address.balance + this.max_delegatable_stake.value - MAX_ALGO_STAKE_PER_ACCOUNT;
    }

    // calculate saturation buffer with 3 decimal precision
    if (this.max_delegatable_stake.value > 0) {
      this.saturation_BUFFER.value = (this.delegated_stake.value * 1000) / this.max_delegatable_stake.value;
    } else {
      this.saturation_BUFFER.value = 1000;
    }
  }

  //----------------------------------------------------------------------------------------------------------

  /** *****************
   * Private Methods  *
   ****************** */
  private getGoOnlineFeeAmount(): uint64 {
    if (!this.getEligibilityFlag()) {
      return globals.payoutsGoOnlineFee;
    }
    return 0;
  }

  private getEligibilityFlag(): boolean {
    return this.app.address.incentiveEligible;
  }
}
