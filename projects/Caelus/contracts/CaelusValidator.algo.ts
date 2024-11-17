import { Contract } from '@algorandfoundation/tealscript';
import { MAX_ALGO_STAKE_PER_ACCOUNT, MAX_DELINQUENCY_TOLERATED, MIN_ALGO_STAKE_FOR_REWARDS, PERFORMANCE_STAKE_INCREASE, PERFORMANCE_STEP } from './constants.algo';

/**
 * Caelus Validator Pool Contract.
 */

export class CaelusValidatorPool extends Contract {
  /** ***************
   * Contract State *
   **************** */
  programVersion = 11;

  // Contract checks params

  creatorContractAppID = GlobalStateKey<AppID>({ key: 'creator' });

  poolName = GlobalStateKey<string>({ key: 'name' });

  validatorPoolContractVersion = GlobalStateKey<uint64>({ key: 'contractVersion' });

  // Operator specific params

  operatorAddress = GlobalStateKey<Address>({ key: 'operator' });

  operatorCommit = GlobalStateKey<uint64>({ key: 'operatorCommit' });

  // Delegated Stake params

  delegatedStake = GlobalStateKey<uint64>({ key: 'delegatedStake' });

  maxDelegatableStake = GlobalStateKey<uint64>({ key: 'maxDStake' });

  // Node performance params

  performanceCounter = GlobalStateKey<uint64>({ key: 'performance' });

  saturationBUFFER = GlobalStateKey<uint64>({ key: 'saturationBuffer' }); // value goes from 0 to 1000

  lastRewardReport = GlobalStateKey<uint64>({ key: 'rewardReport' });

  isDelinquent = GlobalStateKey<boolean>({ key: 'isDelinquent' });

  lastDelinquencyReportBlock = GlobalStateKey<uint64>({ key: 'delinquencyReport' });

  delinquencyScore = GlobalStateKey<uint64>({key:'delinquencyScore'})

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
  createApplication(creatingContract: AppID, operatorAddress: Address, contractVersion: uint64, poolName: string): void {
    this.creatorContractAppID.value = creatingContract;
    this.operatorAddress.value = operatorAddress;
    this.validatorPoolContractVersion.value = contractVersion;
    this.poolName.value = poolName;

    // stake counters
    this.operatorCommit.value = 0;
    this.delegatedStake.value = 0;
    this.maxDelegatableStake.value = 0;

    // init buffer, flags & counters
    this.saturationBUFFER.value = 0;
    this.performanceCounter.value = 0;
    this.delinquencyScore.value = 0;
    this.isDelinquent.value = false;
  }

  /**
   *  Used by the node operator to add to his stake amount for the node
   *
   * @param {PayTxn} commit - node operator stake commitment
   * @throws {Error} if the sender isn't the node operator, the receiver isn't the app address or if the total balance is above 30M Algo
   */
  addToOperatorCommit(commit: PayTxn): void {
    const totalBalanceUpdated = this.operatorCommit.value + commit.amount;
    assert(totalBalanceUpdated < MAX_ALGO_STAKE_PER_ACCOUNT, 'Contract max balance cannot be over 30M Algo');

    verifyPayTxn(commit, {
      sender: this.operatorAddress.value,
      receiver: this.app.address,
      amount: commit.amount,
    });
    this.operatorCommit.value += commit.amount;
    this.updateDelegationFactors();
  }

  /**
   *  Used by the node operator to remove from his stake amount for the node
   * @param {uint64} claimRequest - amount claimed by the node operator to be removed from the contract balance and subtracted from the operator_commit counter
   * @throws {Error} if the sender isn't the node operator or if the total commit by the node operator goes below the min threshold for rewards eligibility
   * @throws {Error} if isDelinquent is True
   */
  removeFromOperatorCommit(claimRequest: uint64): void {
    assert(!this.isDelinquent.value, 'cannot withdraw funds if the account is flagged as delinquent, must solve delinquency first');

    assert(this.txn.sender === this.operatorAddress.value, 'Only the Node Operator can claim his stake');

    assert(
      this.operatorCommit.value - claimRequest > MIN_ALGO_STAKE_FOR_REWARDS,
      'Node Operator can take his stake below 30k only if the node contract will be closed'
    );

    sendPayment({
      sender: this.app.address,
      receiver: this.operatorAddress.value,
      amount: claimRequest,
      fee: 0,
    });

    this.updateDelegationFactors();
  }

  // Todo
  // check where falls the last reported proposed block within the tolerated block delta
  // --> reports delinquency if below expectations; updates last DeliquencyReportBlock and checks if current call is too close from last
  performanceCheck(): void {
    // check to not make checks be stacked in close proximity calls
    assert(globals.round - this.lastDelinquencyReportBlock.value > this.getExpectedProposalsDelta(), 'Wait at least one ProposalsDelta between Performance checks');
    const currentAccountDelta = globals.round - this.app.address.lastProposed;
    const isPerformingAsExpected = this.getExpectedProposalsDelta() > currentAccountDelta 
    const isPerformingAsTolerated = this.getToleratedBlockDelta() > currentAccountDelta 
    // exit if account is performing as expected
    if (isPerformingAsExpected && isPerformingAsTolerated){
      return
    } 
    if (!isPerformingAsExpected){
      this.performanceCounter.value = this.performanceCounter.value > 0 ? this.performanceCounter.value - 1 : 0;
    }
    if (!isPerformingAsTolerated){
      this.delinquencyScore.value++;
      this.delinquencyThresholdCheck()
    }
    this.lastDelinquencyReportBlock.value = globals.round;
  }

  // call this method if Account has been flagged as delinquent; wait fixed amount of time before resetting it; and expects payment if necessary (?)
  solveDelinquency(): void{}

  // private as consequence to RewardReport? 
  fixDelinquencyScore(): void{}

  // calculate tolerated wait for round after the expected threshold has passed
  getToleratedBlockDelta(): uint64 {
    return 0;
  }

  // calculate round number between proposals given the online stake for this account vs total online stake
  getExpectedProposalsDelta(): uint64 {
    return 0;
  }

  // report the proposed block and send the rewards to the rewards_reserve_address; keep the operator fee
  reportRewards(/* block: uint64 */): void {
    // call CaelusAdmin contract
    // use the block proposer to get performance++
    // on successfull reward report clear delinquencyScore (or reduce significantly if last delinquencyReport is older than Delta)
    // use the proposerPayout to declare the amount
    // const report = blocks[block].proposerPayout;
    // const takeFee = (report * 6) / 100;
  }

  // call the auction contract to report the saturation buffer & delegatable stake
  bid(): void {}

  // called by the auction contract to assign stake to the node contract at mint
  addStake(): void {}

  //called by the auction contract at burn
  takeStake():void{}

  // call the auction contract to report the saturation buffer of itself or another validator contract
  snitchBurn(): void {}

  // call to check on performances throught the get_snitched method
  snitch(): void {}

  // TBD if it makes sense to keep this one or not and just move logic to checks methods
  getSnitched(): void {}

  // used by CA contract to remove the delegated stake and send it back to the auction in case of snitch
  clawbackStake(): void {}

  // used by other CV contracts to claim stake in case of stake above limit or for penalty detected by a validator
  clawbackStakeToValidator(): void {}

  // use: callable by anyone through CA; check contract version vs latest;  
  upgradeToNewValidatorVersion(): void{}

  // used by CA to clean up remaining Algo
  claimLeftAlgo(): void {}

  registerToXGov(): void{}

  delegateXGovVoting():void{}

  // shut down contract account
  // only for CA, funds must have been withdrawn first, clean up and close
  closeOutOfApplication(...args: any[]): void {
    
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
   * @throws {Error} if the caller isn't the node operator
   * @throws {Error} if isDelinquent is True
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
      this.txn.sender === this.operatorAddress.value,
      'Only the Node Operator can register online with participation key'
    );

    // Check that contract balance is at least 30k Algo
    assert(
      this.app.address.balance >= globals.payoutsMinBalance,
      'Contract needs 30k Algo as minimum balance for rewards eligibility'
    );

    // Check that operator commit to the contract balance is at least 30k Algo
    assert(
      this.operatorCommit.value >= globals.payoutsMinBalance,
      'Operator commit must be higher than minimum balance for rewards eligibility'
    );
    assert(!this.isDelinquent.value, 'account cannot be set to online if delinquency flag is active, must solve delinquency first');

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
   *                               {1}: node is misbehaving and needs to be set offline by the main Caelus contract
   * 
   */
  goOffline(offlineCase: uint64): void {
    assert(
      this.txn.sender === this.operatorAddress.value || this.txn.sender === this.creatorContractAppID.value.address,
      'Only Node Operator or Caelus Admin contract can set the contract offline'
    );

    if (offlineCase === 0) {
      sendOfflineKeyRegistration({});
    }

    if (offlineCase === 1) {
      assert(
        this.txn.sender === this.creatorContractAppID.value.address,
        'Only the Caelus main contract can set the contract offline and issue a penalty'
      );
      assert(
        this.isDelinquent.value, 'Only Delinquent nodes can be forced offline'
      );
      this.performanceCounter.value = 0;
      this.clawbackStake()  // send delegated stake back to auction contract to be moved to other nodes
      sendOfflineKeyRegistration({});
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

  private delinquencyThresholdCheck(): void{
    this.isDelinquent.value = this.delinquencyScore.value > MAX_DELINQUENCY_TOLERATED 
  }

  private updateDelegationFactors(): void {
    assert(!this.isDelinquent.value, 'Account is delinquent. Solve Delinquency state before updating parameters')
    // start counting from the operator commit
    if (this.operatorCommit.value > MIN_ALGO_STAKE_FOR_REWARDS) {
      this.maxDelegatableStake.value = this.operatorCommit.value;
    } else {
      this.maxDelegatableStake.value = 0;
    }

    // add in the performance counter to increase delegatable amount, increases of 10k delegatable stake per multiples of 5 for performanceCounter
    this.maxDelegatableStake.value += PERFORMANCE_STAKE_INCREASE * (this.performanceCounter.value / PERFORMANCE_STEP);

    // check against MAX_ALGO_STAKE_PER_ACCOUNT (50M)
    if (this.app.address.balance > MAX_ALGO_STAKE_PER_ACCOUNT) {
      this.maxDelegatableStake.value = 0;
    } else if (this.app.address.balance + this.maxDelegatableStake.value > MAX_ALGO_STAKE_PER_ACCOUNT) {
      this.maxDelegatableStake.value =
        MAX_ALGO_STAKE_PER_ACCOUNT - this.app.address.balance;
    }

    // calculate saturation buffer with 3 decimal precision
    if (this.maxDelegatableStake.value > 0) {
      this.saturationBUFFER.value = (this.delegatedStake.value * 1000) / this.maxDelegatableStake.value;
    } else {
      this.saturationBUFFER.value = 1000;
    }
  }
}
