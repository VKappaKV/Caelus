import { Contract } from '@algorandfoundation/tealscript'
import { MAX_DELINQUENCY_TOLERATED, MAX_STAKE_PER_ACCOUNT, PERFORMANCE_STAKE_INCREASE, PERFORMANCE_STEP, VEST_TIER_4, VEST_TIER_5 } from './constants.algo'
import { CaelusAdmin } from './CaelusAdmin.algo'
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

  validatorPoolContractVersion = GlobalStateKey<uint64>({ key: 'contractVersion' })

  xGovVotingAddress = GlobalStateKey<Address>({key: 'xGovVoter'})

  vestID = GlobalStateKey<AssetID>({key:'vestID'})

  stVestID = GlobalStateKey<AssetID>({key:'stVestID'}) 

  // Operator specific params

  operatorAddress = GlobalStateKey<Address>({ key: 'operator' })

  operatorCommit = GlobalStateKey<uint64>({ key: 'operatorCommit' })

  operatorXGovLoan = GlobalStateKey<uint64>({key:'xGovFeePayout'})

  // Delegated Stake params

  delegatedStake = GlobalStateKey<uint64>({ key: 'delegatedStake' })

  maxDelegatableStake = GlobalStateKey<uint64>({ key: 'maxDStake' })

  canBeDelegated = GlobalStateKey<boolean>({ key:'canBeDelegated'})

  // Node performance params

  performanceCounter = GlobalStateKey<uint64>({ key: 'performance' })

  saturationBUFFER = GlobalStateKey<uint64>({ key: 'saturationBuffer' }) // value goes from 0 to 1000

  lastRewardReport = GlobalStateKey<uint64>({ key: 'rewardReport' })

  isDelinquent = GlobalStateKey<boolean>({ key: 'isDelinquent' })

  lastDelinquencyReport = GlobalStateKey<uint64>({ key: 'delinquencyReport' })

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
  createApplication(creatingContract: AppID, operatorAddress: Address, contractVersion: uint64, xGovVotingAddress: Address, vestID: AssetID, stVestID: AssetID): void {
    this.creatorContractAppID.value = creatingContract
    this.operatorAddress.value = operatorAddress
    this.validatorPoolContractVersion.value = contractVersion
    this.xGovVotingAddress.value = xGovVotingAddress
    this.vestID.value = vestID
    this.stVestID.value = stVestID

    // stake counters
    this.operatorCommit.value = 0
    this.delegatedStake.value = 0
    this.maxDelegatableStake.value = 0
    this.canBeDelegated.value = false

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
  // TODO: CHANGE TO MANAGE OPERATOR COMMIT WITH LST
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
  // TODO: CHANGE TO MANAGE OPERATOR COMMIT WITH LST
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

  performanceCheck(): void {
    if (!this.app.address.incentiveEligible){
      this.setDelinquency()
      return
    } 
    // check to not make checks be stacked in close proximity calls
    assert(globals.round - this.lastDelinquencyReport.value > this.getExpectedProposalsDelta()/2, 'Wait at least half the proposal expected time between Performance checks')
    const deltaWithLatestProposal = globals.round - this.app.address.lastProposed
    const isPerformingAsExpected = this.getExpectedProposalsDelta() > deltaWithLatestProposal 
    const isPerformingAsTolerated = this.getToleratedBlockDelta() > deltaWithLatestProposal 
    // exit if account is performing as expected
    if (isPerformingAsExpected && isPerformingAsTolerated){
      return
    } 
    if (!isPerformingAsTolerated){
      this.delinquencyScore.value += 5
    } else if (!isPerformingAsExpected){
      this.delinquencyScore.value += this.lastDelinquencyReport.value > this.lastRewardReport.value || this.delinquencyScore.value > 5 ? 2 : 1
    }
    this.setDelinquencyOnThresholdCheck()
    this.lastDelinquencyReport.value = globals.round
    return
  }

  // call this method if Account has been flagged as delinquent wait fixed amount of time before resetting it and expects payment if necessary (?)
  solveDelinquency(): void{
    assert(this.isDelinquent.value, 'Account is not delinquent')
    assert(this.txn.sender === this.operatorAddress.value, 'Only the Node Operator can clear up Delinquency')
    assert(this.delegatedStake.value == 0, 'Before clearing up delinquency all the delegated stake must be redistributed')
    assert(this.lastDelinquencyReport.value < this.lastRewardReport.value) // validator has to win a proposal to clear up delinquency
    assert(this.delinquencyThresholdCheck(), 'Delinquency score must be below threshold')
    this.isDelinquent.value = false
    this.canBeDelegated.value = true
  }


  reportRewards(block: uint64): void {
    const isOperatorReportTime = globals.round - block < 700
    const report = blocks[block].proposerPayout
    const takeFee = (report * 6) / 100
    
    this.pendingGroup.addMethodCall<typeof CaelusAdmin.prototype.declareRewards, void>({
      applicationID: this.creatorContractAppID.value,
      methodArgs: [{
        receiver: this.creatorContractAppID.value.address,
        amount: report - takeFee,
        fee: 0,
      }]
    })
    
    if (this.getExpectedProposalsDelta() < (globals.round - this.lastRewardReport.value)){
      this.performanceCounter.value += 1
    } 
    this.fixDelinquencyScore()
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
  // do I need this?
  takeStakeRequest(stakeTxn: PayTxn): void{
    assert(this.canBeDelegated.value, 'Account cannot take more delegated stake')
  }

  // called by the auction contract to assign stake to the node contract 
  addStake(txnWithStake: PayTxn): void {
    // should I check receiver? Is there a problem if not? Sender would just be gifting Algo would this fuck up calculation for the LST?
    verifyPayTxn(txnWithStake, {
      receiver: this.app.address
    })
    this.delegatedStake.value += txnWithStake.amount
    this.updateDelegationFactors()
  }

  //called by the auction contract at burn
  burnStake(amountRequested: uint64, receiverBurn: Address):void{
    assert(this.txn.sender === this.creatorContractAppID.value.address, 'Only the Caelus Admin contract can call this method')
    assert(amountRequested <= this.delegatedStake.value, 'Cannot withdraw more stake than the delegated amount') // this or take only what you can and communicate back the remaining request
    sendPayment({
      amount: amountRequested,
      receiver: receiverBurn,
    })
    this.delegatedStake.value -= amountRequested
    this.updateDelegationFactors()
  }
  
  // make the checks required by the above snitch method
  getSnitched(): void {}

  // used by CA contract to remove the delegated stake and send it back to the auction in case of snitch
  clawbackStake(): void {}

  // used by other CV contracts to claim stake in case of stake above limit or for penalty detected by a validator
  clawbackStakeToValidator(): void {}

  // use: callable by anyone through CA check contract version vs latest  
  upgradeToNewValidatorVersion(): void{}

  // use this to allow for a flashloan 
  flashloan(amount: uint64, receiver: Address): void{
    let repaid = false
    assert(this.txn.sender === this.creatorContractAppID.value.address , 'Caller must be the Caelus Admin Contract')

    for (let i = this.txn.groupIndex; i<this.txnGroup.length ; i++){
      const txn = this.txnGroup[i]

      if(txn.receiver === this.app.address && txn.amount === amount){
        repaid = true
        break
      }
    }
    assert(repaid, 'must repay the loan!')
    sendPayment({
      receiver: receiver,
      amount: amount,
      fee: 0
    })
  }

  // used by CA to clean up remaining Algo
  claimLeftAlgo(): void {
    assert(this.app.address.voterBalance == 0, 'Account Stake must be offline') // is there another flag to check online/offline status?
    assert(this.delegatedStake.value == 0, 'All delegated Stake must have been removed')
    assert(this.operatorCommit.value == 0, 'Node Operator must have withdrawn his commitment')
    // TODO make app call to send remaining Algo back to auction contract
  }

  // make sure there's no delegated stake, return the operator commit to the operatorAddress and remove all operator related GKeys
  operatorExit(): void{
    assert(this.app.address.voterBalance === 0, 'Account is online, sign it offline before exiting')
    assert(this.txn.sender === this.operatorAddress.value, 'Only the Node Operator can issue this transaction')    
  }

  // shut down contract account
  // only for CA, funds must have been withdrawn first, clean up with optout and closeout the balance to the auction
  closeOutOfApplication(...args: any[]): void {}

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

    // Check that contract balance is at least 30k Algo and less than MAX_STAKE_PER_ACCOUNT
    assert(
      this.app.address.balance >= globals.payoutsMinBalance && this.app.address.balance <= MAX_STAKE_PER_ACCOUNT,
      'Contract needs 30k Algo as minimum balance for rewards eligibility and at most 50M Algo'
    )

    // Check that operator commit to the contract balance is at least 30k Algo
    assert(
      this.operatorCommit.value >= globals.payoutsMinBalance,
      'Operator commit must be higher than minimum balance for rewards eligibility'
    )
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
    this.canBeDelegated.value = true
  }

  /**
   * Set the contract account to offline so that it doesn't participate in consensus anymore.
   * No force offline by the protocol (might be changed to a very long time wait in case the node isn't proposing blocks at all). Lookup Delinquency status 
   * Once the account is set offline the method ensures that it cannot be delegated to.
   *                              
   * 
   */
  goOffline(): void {
    assert(
      this.txn.sender === this.operatorAddress.value || this.txn.sender === this.creatorContractAppID.value.address,
      'Only Node Operator or Caelus Admin contract can set the contract offline'
    )
      this.canBeDelegated.value = false
      sendOfflineKeyRegistration({})
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

  private setDelinquencyOnThresholdCheck(): void{
    if (!this.delinquencyThresholdCheck()){
      this.setDelinquency()
    }
  }

  private delinquencyThresholdCheck(): boolean{
    if(this.delinquencyScore.value > MAX_DELINQUENCY_TOLERATED){
      return false
    }
    return true 
  }

  private setDelinquency(): void{
    this.canBeDelegated.value = false
    this.performanceCounter.value = 0
    this.updateDelegationFactors() 
    this.isDelinquent.value = true
  }

  private fixDelinquencyScore(): void{
    if(this.delinquencyScore.value == 0){
      return
    }
    if (this.isDelinquent.value){
      this.delinquencyScore.value -= 5 
    }
    this.delinquencyScore.value = 0
  }

  private updateDelegationFactors(): void {
    assert(!this.isDelinquent.value, 'Account is delinquent. Solve Delinquency state before updating parameters')
    // start counting from the operator commit
    if (this.operatorCommit.value > globals.payoutsMinBalance && this.canBeDelegated.value) {

      this.maxDelegatableStake.value = this.operatorCommit.value

      // boost commit with VEST tier: tier 4 is a 50% increase and tier 5 is a 100% increase
      const vestBoost = (this.getTierVEST() * this.operatorCommit.value) / 2
      this.maxDelegatableStake.value += vestBoost

      // add in the performance counter to increase delegatable amount, increases of 10k delegatable stake per multiples of 5 for performanceCounter
      this.maxDelegatableStake.value += PERFORMANCE_STAKE_INCREASE * (this.performanceCounter.value / PERFORMANCE_STEP)

      // check against globals.payoutsMaxBalance (50M)
      if (this.app.address.balance >= MAX_STAKE_PER_ACCOUNT) {
        this.maxDelegatableStake.value = 0
      } else if (this.app.address.balance + this.maxDelegatableStake.value > MAX_STAKE_PER_ACCOUNT) {
        this.maxDelegatableStake.value =
          MAX_STAKE_PER_ACCOUNT- this.app.address.balance
      }
    } else {
      this.maxDelegatableStake.value = 0
    }  

    // calculate saturation buffer with 3 decimal precision & set flag for delegation eligibility
    if (this.maxDelegatableStake.value > 0) {
      this.saturationBUFFER.value = (this.delegatedStake.value * 1000) / this.maxDelegatableStake.value
      this.canBeDelegated.value = true
    } else {
      this.saturationBUFFER.value = 1000
      this.canBeDelegated.value = false
    }
  }

  private getTierVEST(): uint64{
    const lockedVEST = this.operatorAddress.value.assetBalance(this.stVestID.value)
    const ownedVEST = this.operatorAddress.value.assetBalance(this.vestID.value)
    if (lockedVEST + ownedVEST >= VEST_TIER_5){
      return 2
    }
    if (lockedVEST + ownedVEST >= VEST_TIER_4){
      return 1
    }
    return 0
  }


  private getToleratedBlockDelta(): uint64 {
    return this.getExpectedProposalsDelta() * 5
  }

  private getExpectedProposalsDelta(): uint64 {
    const currentOnlineStake = onlineStake()
    const currentAccountStake = this.app.address.voterBalance
    const roundDelta = currentOnlineStake / currentAccountStake
    return roundDelta*10
  }
}
