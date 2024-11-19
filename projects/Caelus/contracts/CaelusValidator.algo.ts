import { Contract } from '@algorandfoundation/tealscript'
import { MAX_DELINQUENCY_TOLERATED, PERFORMANCE_STAKE_INCREASE, PERFORMANCE_STEP } from './constants.algo'

/**
 * Caelus Validator Pool Contract.
 */

export class CaelusValidatorPool extends Contract {
  /** ***************
   * Contract State *
   **************** */
  programVersion = 11

  // Contract checks params

  creatorContractAppID = GlobalStateKey<AppID>({ key: 'creator' })

  poolName = GlobalStateKey<string>({ key: 'name' })

  validatorPoolContractVersion = GlobalStateKey<uint64>({ key: 'contractVersion' })

  xGovVotingAddress = GlobalStateKey<Address>({key: 'xGovVoter'})

  // Operator specific params

  operatorAddress = GlobalStateKey<Address>({ key: 'operator' })

  operatorCommit = GlobalStateKey<uint64>({ key: 'operatorCommit' })

  operatorXGovLoan = GlobalStateKey<uint64>({key:'xGovFeePayout'})

  // Delegated Stake params

  delegatedStake = GlobalStateKey<uint64>({ key: 'delegatedStake' })

  maxDelegatableStake = GlobalStateKey<uint64>({ key: 'maxDStake' })

  canDelegate = GlobalStateKey<boolean>({ key:'canDelegate'})

  // Node performance params

  performanceCounter = GlobalStateKey<uint64>({ key: 'performance' })

  saturationBUFFER = GlobalStateKey<uint64>({ key: 'saturationBuffer' }) // value goes from 0 to 1000

  lastRewardReport = GlobalStateKey<uint64>({ key: 'rewardReport' })

  isDelinquent = GlobalStateKey<boolean>({ key: 'isDelinquent' })

  lastDelinquencyReportBlock = GlobalStateKey<uint64>({ key: 'delinquencyReport' })

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
  createApplication(creatingContract: AppID, operatorAddress: Address, contractVersion: uint64, poolName: string, xGovVotingAddress: Address): void {
    this.creatorContractAppID.value = creatingContract
    this.operatorAddress.value = operatorAddress
    this.validatorPoolContractVersion.value = contractVersion
    this.xGovVotingAddress.value = xGovVotingAddress
    this.poolName.value = poolName

    // stake counters
    this.operatorCommit.value = 0
    this.delegatedStake.value = 0
    this.maxDelegatableStake.value = 0
    this.canDelegate.value = false

    // init buffer, flags & counters
    this.saturationBUFFER.value = 0
    this.performanceCounter.value = 0
    this.delinquencyScore.value = 0
    this.isDelinquent.value = false
  }

  /**
   *  Used by the node operator to add to his stake amount for the node
   *
   * @param {PayTxn} commit - node operator stake commitment
   * @throws {Error} if the sender isn't the node operator, the receiver isn't the app address or if the total balance is above 30M Algo
   */
  addToOperatorCommit(commit: PayTxn): void {
    const totalBalanceUpdated = this.operatorCommit.value + commit.amount
    assert(totalBalanceUpdated < globals.payoutsMaxBalance, 'Contract max balance cannot be over 30M Algo') 

    verifyPayTxn(commit, {
      sender: this.operatorAddress.value,
      receiver: this.app.address,
      amount: commit.amount,
    })
    this.operatorCommit.value += commit.amount
    this.updateDelegationFactors()
  }

  /**
   *  Used by the node operator to remove from his stake amount for the node
   * @param {uint64} claimRequest - amount claimed by the node operator to be removed from the contract balance and subtracted from the operator_commit counter
   * @throws {Error} if the sender isn't the node operator or if the total commit by the node operator goes below the min threshold for rewards eligibility
   * @throws {Error} if isDelinquent is True
   */
  removeFromOperatorCommit(claimRequest: uint64): void {
    assert(!this.isDelinquent.value, 'cannot withdraw funds if the account is flagged as delinquent, must solve delinquency first')

    assert(this.txn.sender === this.operatorAddress.value, 'Only the Node Operator can claim his stake')

    assert(
      this.operatorCommit.value - claimRequest > globals.payoutsMinBalance, 
      'Node Operator can take his stake below 30k only if the node contract will be closed'
    )

    assert(
      this.operatorCommit.value > claimRequest, 'Node Operator cannot claim more than he has'
    )

    sendPayment({
      sender: this.app.address,
      receiver: this.operatorAddress.value,
      amount: claimRequest,
      fee: 0,
    })

    this.updateDelegationFactors()
  }

  // Todo
  // check where falls the last reported proposed block within the tolerated block delta
  // --> reports delinquency if below expectations updates last DeliquencyReportBlock and checks if current call is too close from last
  performanceCheck(): void {
    if (!this.app.address.incentiveEligible){
      this.setDelinquency()
    } 
    // check to not make checks be stacked in close proximity calls
    assert(globals.round - this.lastDelinquencyReportBlock.value > this.getExpectedProposalsDelta(), 'Wait at least one ProposalsDelta between Performance checks')
    const deltaWithLatestProposal = globals.round - this.app.address.lastProposed
    // todo: check if isPerformingAsExpected needs a higher delay
    const isPerformingAsExpected = this.getExpectedProposalsDelta() > deltaWithLatestProposal 
    const isPerformingAsTolerated = this.getToleratedBlockDelta() > deltaWithLatestProposal 
    // exit if account is performing as expected
    if (isPerformingAsExpected && isPerformingAsTolerated){
      return
    } 
    if (!isPerformingAsExpected && this.app.address.lastHeartbeat < globals.round - this.getExpectedProposalsDelta()){
      this.performanceCounter.value = this.performanceCounter.value > 0 ? this.delinquencyScore.value++ : 0
    }
    if (!isPerformingAsTolerated){
      this.delinquencyScore.value += 4
      this.delinquencyThresholdCheck() // if higher than tolerated will set account to isDelinquent should this be an automatic follow up to set account offline?
    }
    this.lastDelinquencyReportBlock.value = globals.round
  }

  private setDelinquency(): void{
    this.canDelegate.value = false
    this.performanceCounter.value = 0
    this.updateDelegationFactors() 
    this.isDelinquent.value = true
  }

  // call this method if Account has been flagged as delinquent wait fixed amount of time before resetting it and expects payment if necessary (?)
  solveDelinquency(): void{
    assert(this.isDelinquent.value, 'Account is not delinquent')
    // should there be an additional fee?
    assert(this.delegatedStake.value == 0, 'Before clearing up delinquency all the delegated stake must be redistributed')
    this.isDelinquent.value = true
    this.canDelegate.value = true
  }

  private fixDelinquencyScore(): void{
    if(this.delinquencyScore.value <= 0){
      return
    }
    // cleanup only if the latest delinquency report is far older 
    if(globals.round - this.lastDelinquencyReportBlock.value < this.getToleratedBlockDelta()){
      return
    }
    this.delinquencyScore.value = 0
  }

  // calculate tolerated wait for round after the expected threshold has passed
  private getToleratedBlockDelta(): uint64 {
    return this.getExpectedProposalsDelta() * 10 
  }

  // calculate round number between proposals given the online stake for this account vs total online stake
  private getExpectedProposalsDelta(): uint64 {
    const currentOnlineStake = onlineStake() // is this in microAlgo ?
    const currentAccountStake = this.app.address.voterBalance
    const accountTotalStakeShare = currentAccountStake / currentOnlineStake
    // TODO how to calculate the number of rounds per DAY/EPOCH -> How many does the account propose? --> calculate the delta  set a rounding error
    return 0
  }

  // report the proposed block and send the rewards to the rewards_reserve_address keep the operator fee
  reportRewards(block: uint64): void {
    const isOperatorReportTime = globals.round - block < 700
    const report = blocks[block].proposerPayout
    const takeFee = (report * 6) / 100

    // TODO send here the payout to the CaelusAdmin if it fails it won't advance the value update in the method : amount = report - takeFee
    
    if (this.getExpectedProposalsDelta() < (globals.round - this.lastRewardReport.value)){
      this.performanceCounter.value++
      this.fixDelinquencyScore()
    }
    this.lastRewardReport.value = block
    if(isOperatorReportTime){
      this.operatorCommit.value += takeFee
    } else { //snitch rewards
      const snitched = takeFee / 2
      const opKeeps = takeFee - snitched // might there be some math float bs that just using both /2 it breaks 
      this.operatorCommit.value += opKeeps
      sendPayment({
        receiver: this.txn.sender,
        amount: snitched,
        fee: 0
      })
    }
    this.updateDelegationFactors()
  }

  // call the auction contract to report the saturation buffer & delegatable stake
  bid(): void {
    assert(this.canDelegate.value, 'Account cannot take more delegated stake')
    // TODO
  }

  // called by the auction contract to assign stake to the node contract at mint
  addStake(txnWithStake: PayTxn): void {
    // should I check receiver? Is there a problem if not? Sender would just be gifting Algo would this fuck up calculation for the LST?
    verifyPayTxn(txnWithStake, {
      receiver: this.app.address
    })
    this.delegatedStake.value += txnWithStake.amount
    this.updateDelegationFactors()
  }

  //called by the auction contract at burn
  takeStake():void{}

  // call the auction contract to report the saturation buffer of itself or another validator contract
  snitchBurn(): void {}

  // call to check on performances throught the get_snitched method && check IE flag for good measure || if the snitch picks up a True value then increase node performance counter
  snitch(): void {}

  // TBD if it makes sense to keep this one or not and just move logic to checks methods
  getSnitched(): void {}

  // used by CA contract to remove the delegated stake and send it back to the auction in case of snitch
  clawbackStake(): void {}

  // used by other CV contracts to claim stake in case of stake above limit or for penalty detected by a validator
  clawbackStakeToValidator(): void {}

  // use: callable by anyone through CA check contract version vs latest  
  upgradeToNewValidatorVersion(): void{}

  // to use in case of IE flag drop (whatever the case an attacker sent enough Algo to set the Balance above the threshold)
  resetIncentiveEligibleFlag(): void{}

  // used by CA to clean up remaining Algo
  claimLeftAlgo(): void {
    assert(this.app.address.voterBalance == 0, 'Account Stake must be offline') // is there another flag to check online/offline status?
    assert(this.delegatedStake.value == 0, 'All delegated Stake must have been removed')
    assert(this.operatorCommit.value == 0, 'Node Operator must have withdrawn his commitment')
    // TODO make app call to send remaining Algo back to auction contract
  }

  registerToXGov(): void{}

  delegateXGovVoting(): void{}

  // cleanup all the value of stake by giving back to the operator his own commit and to the auction the stake currently in the account
  // reset 
  resetApp(): void{}

  // make sure there's no delegated stake, return the operator commit to the operatorAddress and remove all operator related GKeys
  operatorExit(): void{}

  operatorRotation(): void{}

  operatorUpdate(): void{}

  // shut down contract account
  // only for CA, funds must have been withdrawn first, clean up with optout and closeout the balance to the auction
  closeOutOfApplication(...args: any[]): void {
    
  }

  /**
   * Used to set the Contract account online for consensus. Always check that account is online and incentivesEligible before having delegatable stake
   *
   * @param {PayTxn} feePayment - Payment transaction to the contract to cover costs for Eligibility fee 0 for renewal.
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
    )

    // Check that contract balance is at least 30k Algo
    assert(
      this.app.address.balance >= globals.payoutsMinBalance,
      'Contract needs 30k Algo as minimum balance for rewards eligibility'
    )

    // Check that operator commit to the contract balance is at least 30k Algo
    assert(
      this.operatorCommit.value >= globals.payoutsMinBalance,
      'Operator commit must be higher than minimum balance for rewards eligibility'
    )
    assert(!this.isDelinquent.value, 'account cannot be set to online if delinquency flag is active, must solve delinquency first')

    const extraFee = this.getGoOnlineFeeAmount()

    verifyPayTxn(feePayment, { receiver: this.app.address, amount: extraFee })

    sendOnlineKeyRegistration({
      votePK: votePK,
      selectionPK: selectionPK,
      stateProofPK: stateProofPK,
      voteFirst: voteFirst,
      voteLast: voteLast,
      voteKeyDilution: voteKeyDilution,
      fee: extraFee,
    })
    this.canDelegate.value = true
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
    )

    if (offlineCase === 0) {
      this.canDelegate.value = false
      sendOfflineKeyRegistration({})
    }

    if (offlineCase === 1) {
      assert(
        this.txn.sender === this.creatorContractAppID.value.address,
        'Only the Caelus main contract can set the contract offline and issue a penalty'
      )
      assert(
        this.isDelinquent.value, 'Only Delinquent nodes can be forced offline'
      )
      this.performanceCounter.value = 0
      this.clawbackStake()  // send delegated stake back to auction contract to be moved to other nodes
      sendOfflineKeyRegistration({})
    }
  }
  

  //----------------------------------------------------------------------------------------------------------

  /** *****************
   * Private Methods  *
   ****************** */
  private getGoOnlineFeeAmount(): uint64 {
    if (!this.getEligibilityFlag()) {
      return globals.payoutsGoOnlineFee
    }
    return 0
  }

  @abi.readonly
  getEligibilityFlag(): boolean {
    return this.app.address.incentiveEligible
  }

  private delinquencyThresholdCheck(): void{
    if(this.delinquencyScore.value > MAX_DELINQUENCY_TOLERATED){
      this.setDelinquency()
    }  
  }

  private updateDelegationFactors(): void {
    assert(!this.isDelinquent.value, 'Account is delinquent. Solve Delinquency state before updating parameters')
    // start counting from the operator commit
    if (this.operatorCommit.value > globals.payoutsMinBalance && this.canDelegate.value) {
      this.maxDelegatableStake.value = this.operatorCommit.value
    } else {
      this.maxDelegatableStake.value = 0
    }

    // add in the performance counter to increase delegatable amount, increases of 10k delegatable stake per multiples of 5 for performanceCounter
    this.maxDelegatableStake.value += PERFORMANCE_STAKE_INCREASE * (this.performanceCounter.value / PERFORMANCE_STEP)

    // check against globals.payoutsMaxBalance (50M)
    if (this.app.address.balance > globals.payoutsMaxBalance) {
      this.maxDelegatableStake.value = 0
    } else if (this.app.address.balance + this.maxDelegatableStake.value > globals.payoutsMaxBalance) {
      this.maxDelegatableStake.value =
        globals.payoutsMaxBalance - this.app.address.balance
    }

    // calculate saturation buffer with 3 decimal precision
    if (this.maxDelegatableStake.value > 0) {
      this.saturationBUFFER.value = (this.delegatedStake.value * 1000) / this.maxDelegatableStake.value
    } else {
      this.saturationBUFFER.value = 1000
    }
  }
}
