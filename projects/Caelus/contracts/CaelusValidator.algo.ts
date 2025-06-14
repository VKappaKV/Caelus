/* eslint-disable no-underscore-dangle */
/* eslint-disable import/no-cycle */
import { Contract } from '@algorandfoundation/tealscript';
import {
  SnitchInfo,
  MAX_DELINQUENCY_TOLERATED,
  MAX_STAKE_PER_ACCOUNT,
  OPERATOR_REPORT_MAX_TIME,
  PERFORMANCE_STAKE_INCREASE,
  PERFORMANCE_STEP,
  VALIDATOR_COMMISSION,
  NOT_DELEGATABLE_STATUS,
  DELINQUENCY_STATUS,
  NEUTRAL_STATUS,
  BUFFER_MAX,
} from './constants.algo';

import { CaelusAdmin } from './CaelusAdmin.algo';

/**
 * Vestguard Validator Pool Contract is the contract account participating in the consensus protocol and receiver of the delegated stake.
 * Each Pool has a node operator who's responsible for the correct behavior of the node to which the account is participating with.
 * Misbehaviors are controlled through possible regular checks by anyone.
 * The more the contract proposes blocks within the expected time the more delegated stake it can accrue. It's important for the node operator to be declaring to the admin contract which blocks it has proposed to successfully be recognized his share of the amount.
 * Delinquency state is required to properly deter node operators from misbehaving, while it doesn't slash on delinquency the contract delegated stake is routed away, so no delegated stake is at risk or ends up underperforming.
 */

export class CaelusValidatorPool extends Contract {
  programVersion = 11;

  creatorContractAppID = GlobalStateKey<AppID>({ key: 'creator' });

  validatorPoolContractVersion = GlobalStateKey<uint64>({
    key: 'contract_version',
  });

  tokenId = GlobalStateKey<AssetID>({ key: 'token_id' });

  boostTokenID = GlobalStateKey<AssetID>({ key: 'boost_token_id' });

  // Operator specific params

  operatorAddress = GlobalStateKey<Address>({ key: 'operator' });

  operatorCommit = GlobalStateKey<uint64>({ key: 'operator_commit' });

  operatorYieldAccrued = GlobalStateKey<uint64>({ key: 'operator_yield_accrued' });

  // Delegated Stake params

  delegatedStake = GlobalStateKey<uint64>({ key: 'delegated_stake' });

  maxDelegatableStake = GlobalStateKey<uint64>({
    key: 'max_delegatable_stake',
  });

  status = GlobalStateKey<uint64>({ key: 'status' }); // 0 : ok; 1 : can't be delegated; 2 : delinquent

  // Node performance params

  performanceCounter = GlobalStateKey<uint64>({ key: 'performance' });

  saturationBuffer = GlobalStateKey<uint64>({ key: 'saturation_buffer' }); // value goes from 0 to 1000

  lastRewardReport = GlobalStateKey<uint64>({ key: 'reward_report' });

  lastDelinquencyReport = GlobalStateKey<uint64>({ key: 'delinquency_report' });

  delinquencyScore = GlobalStateKey<uint64>({ key: 'delinquency_score' });

  // for Flash Loan

  balanceCheckpoint = GlobalStateKey<uint64>({ key: 'balance_checkpoint' });

  repaid = GlobalStateKey<boolean>({ key: 'repaid' });

  /**
   * createApplication method called at creation, initializes some globalKey values
   * @param {AppID} creatingContract - ApplicationID for the creator contract (CaelusAdminContract)
   * @param {Address} operatorAddress - Address of the node operator used to sign online/offline txns and participate in auctions
   * @param {uint64} contractVersion - Approval Program version for the node contract, stored in the CaelusAdminContract
   * @param {AssetID} tokenId - AssetID of the LST token
   */

  createApplication(
    creatingContract: AppID,
    operatorAddress: Address,
    contractVersion: uint64,
    tokenId: AssetID
  ): void {
    assert(creatingContract === globals.callerApplicationID);
    this.creatorContractAppID.value = creatingContract;
    this.operatorAddress.value = operatorAddress;
    this.validatorPoolContractVersion.value = contractVersion;

    this.tokenId.value = tokenId;

    // stake counters
    this.operatorCommit.value = 0;
    this.operatorYieldAccrued.value = 0;
    this.delegatedStake.value = 0;
    this.maxDelegatableStake.value = 0;

    // init buffer, flags & counters
    this.status.value = NOT_DELEGATABLE_STATUS;
    this.saturationBuffer.value = 0;
    this.performanceCounter.value = 0;
    this.delinquencyScore.value = 0;
    this.lastRewardReport.value = 0;
    this.lastDelinquencyReport.value = 0;

    this.repaid.value = true;
  }

  /**
   * ARC4 PUBLIC METHODS
   */

  optIntoLST(): void {
    assert(!this.app.address.isOptedInToAsset(this.tokenId.value), 'already opted in tokenId');
    const lst = this.creatorContractAppID.value.globalState('token_id') as AssetID;
    sendAssetTransfer({
      assetReceiver: this.app.address,
      xferAsset: lst,
      assetAmount: 0,
    });
  }

  /**
   *  followup operation called by the Vestguard Admin to send the correct amount into the operator commit
   *
   * @param {PayTxn} opStake - node operator stake commitment
   */
  __addToOperatorCommit(opStake: PayTxn): void {
    assert(
      this.txn.sender === this.creatorContractAppID.value.address,
      'only Vestguard admin can route operator stake without LST'
    );
    assert(
      this.operatorCommit.value + opStake.amount <= MAX_STAKE_PER_ACCOUNT,
      'Operator commit cannot exceed 50M Algo'
    );
    verifyPayTxn(opStake, {
      receiver: this.app.address,
    });
    this.operatorCommit.value += opStake.amount;
    if (this.status.value === DELINQUENCY_STATUS) {
      return;
    }
    this.updateDelegationFactors();

    this.operatorCommitUpdateEvent.log({
      app: this.app,
      operator: this.operatorAddress.value,
      amountAdded: opStake.amount,
      amountRemoved: 0,
    });
  }

  /**
   *  Used by the node operator to remove from his stake amount for the node
   * @param {uint64} claimRequest - amount claimed by the node operator to be removed from the operator_commit counter and moved into delegated stake
   * @param {uint64} claimRequestLST - amount of LST to be sent back to the node operator
   */
  __removeFromOperatorCommit(claimRequest: uint64, claimRequestLST: uint64): void {
    assert(this.txn.sender === this.creatorContractAppID.value.address);
    assert(
      this.status.value !== DELINQUENCY_STATUS,
      'cannot withdraw funds if the account is flagged as delinquent, must solve delinquency first'
    );
    assert(
      this.operatorCommit.value - claimRequest > globals.payoutsMinBalance,
      'Node Operator can take his stake below 30k only if the node contract will be closed'
    );
    assert(this.operatorCommit.value > claimRequest, 'Node Operator cannot claim more than he has');

    // removing op commit equals to send back to the operator the LST amount he is burning
    sendAssetTransfer({
      xferAsset: this.tokenId.value,
      assetReceiver: this.operatorAddress.value,
      assetAmount: claimRequestLST,
    });
    // the burn amount in Algo is removed from the op commit and moved into delegated stake
    this.operatorCommit.value -= claimRequest;
    this.delegatedStake.value += claimRequest;
    this.updateDelegationFactors();

    this.operatorCommitUpdateEvent.log({
      app: this.app,
      operator: this.operatorAddress.value,
      amountAdded: 0,
      amountRemoved: claimRequest,
    });
  }

  __updateYieldAccrued(yieldAccruedTxn: PayTxn): void {
    verifyPayTxn(yieldAccruedTxn, {
      sender: this.creatorContractAppID.value.address,
      receiver: this.app.address,
      amount: { lessThanEqualTo: this.operatorYieldAccrued.value },
    });
    this.operatorYieldAccrued.value -= yieldAccruedTxn.amount;
    this.operatorCommit.value += yieldAccruedTxn.amount;
    this.updateDelegationFactors();
    this.operatorCommitUpdateEvent.log({
      app: this.app,
      operator: this.operatorAddress.value,
      amountAdded: yieldAccruedTxn.amount,
      amountRemoved: 0,
    });
  }

  /**
   * Delinquent Validators need to propose a valid block to clear up their delinquency status.
   *
   * This method should be called when the delinquency score is below the threshold and the operator has proposed a block.
   *
   * @param block - block number of the block proposed by the node operator while the account was in delinquency
   */
  solveDelinquency(block: uint64): void {
    assert(this.status.value === DELINQUENCY_STATUS, 'Account is not delinquent');
    assert(this.txn.sender === this.operatorAddress.value, 'Only the Node Operator can clear up Delinquency');
    assert(
      this.delegatedStake.value === 0,
      'Before clearing up delinquency all the delegated stake must have been redistributed'
    );
    assert(blocks[block].proposer === this.app.address, 'the solving block must be proposed by this account');
    assert(this.lastDelinquencyReport.value < block); // validator has to win a proposal sooner than latest delinquency report to clear up delinquency
    assert(this.delinquencyThresholdCheck(), 'Delinquency score must be below threshold');
    this.status.value = NEUTRAL_STATUS;
    this.updateDelegationFactors();
    sendMethodCall<typeof CaelusAdmin.prototype.__reMintDelinquentCommit, void>({
      applicationID: this.creatorContractAppID.value,
      methodArgs: [this.app],
    });

    this.solvedDelinquencyEvent.log({
      app: this.app,
      operator: this.operatorAddress.value,
      stake: this.operatorCommit.value,
    });
  }

  /**
   * Called by the node operator to report the rewards of a block proposed by the contract account.
   *
   * @param {uint64} block - Block number of the block proposed by the node operator
   *
   */
  reportRewards(block: uint64): void {
    assert(blocks[block].proposer === this.app.address);
    // In a hypothetical where a block proposer proposed two blocks s/he should always report the blocks from the oldest block first.
    // No loss of funds if this doesn't happen, but they don't end up recorded as rewards, instead goes to the dust fund.
    assert(block > this.lastRewardReport.value);
    const isOperatorReportTime = globals.round - block < OPERATOR_REPORT_MAX_TIME;
    const report = blocks[block].proposerPayout;
    const takeFee = wideRatio([report, VALIDATOR_COMMISSION], [100]);

    if (this.getExpectedProposalsDelta() > globals.round - this.lastRewardReport.value) {
      this.performanceCounter.value += 1;
    }
    this.fixDelinquencyScore();
    this.lastRewardReport.value = block;
    if (isOperatorReportTime) {
      this.operatorCommit.value += takeFee;
    } else {
      sendPayment({
        receiver: this.txn.sender,
        amount: takeFee,
      });
    }

    sendMethodCall<typeof CaelusAdmin.prototype.declareRewards>({
      applicationID: this.creatorContractAppID.value,
      methodArgs: [
        this.app,
        block,
        {
          receiver: this.creatorContractAppID.value.address,
          amount: report - takeFee,
        },
      ],
    });

    this.updateDelegationFactors();

    this.rewardsEvent.log({
      app: this.app,
      block: block,
      payout: report,
    });
  }

  /**
   * FOLLOWUP OPERATION CALLED BY THE Vestguard ADMIN TO SEND THE DELEGATED STAKE TO THE NODE OPERATOR
   *
   * Receive delegated stake and update the delegation factors.
   *
   * @param {PayTxn} txnWithStake - Payment transaction to the contract account with the delegated stake
   */
  __addStake(txnWithStake: PayTxn): void {
    verifyPayTxn(txnWithStake, {
      sender: this.creatorContractAppID.value.address,
      receiver: this.app.address,
    });
    this.delegatedStake.value += txnWithStake.amount;
    this.updateDelegationFactors();
  }

  /**
   * FOLLOWUP OPERATION CALLED BY THE Vestguard ADMIN TO CLAWBACK THE DELEGATED STAKE ON BURN OPERATION
   *
   * @param {uint64} amountRequested - amount of Algo to be burned
   * @param {Address} receiverBurn - address of the receiver of the burn transaction triggered on the Vestguard Admin contract
   */
  __burnStake(amountRequested: uint64, receiverBurn: Address): void {
    assert(
      this.txn.sender === this.creatorContractAppID.value.address,
      'Only the Vestguard Admin contract can call this method'
    );
    assert(amountRequested <= this.delegatedStake.value, 'Cannot withdraw more stake than the delegated amount'); // this or take only what you can and communicate back the remaining request
    assert(
      this.app.address.balance - amountRequested >= this.operatorCommit.value,
      'Cannot leave the Opperator with less than their own stake'
    );
    sendPayment({
      amount: amountRequested,
      receiver: receiverBurn,
    });
    this.delegatedStake.value -= amountRequested;
    this.updateDelegationFactors();
  }

  /**
   * Snitch another Validator Contract. A valid snitch will improve the performance counter.
   * @param {AppID} appToSnitch - ApplicationID of the validator to be snitched
   * @param {SnitchInfo} params - parameters to check for the validator (For example: performanceCheck, stakeAmountCheck, delinquentCheck, versionCheck)
   */
  snitchValidator(appToSnitch: AppID, params: SnitchInfo): void {
    assert(this.status.value !== DELINQUENCY_STATUS, 'Cannot snitch if the account is delinquent');
    const result = sendMethodCall<typeof CaelusValidatorPool.prototype.getSnitched, boolean>({
      applicationID: appToSnitch,
      methodArgs: [params],
    });
    if (result) {
      this.performanceCounter.value += 1;
    }
    this.updateDelegationFactors();

    this.snitchValidatorEvent.log({ request: params, result: result });
  }

  getSnitched(checks: SnitchInfo): boolean {
    let result = false;

    if (checks.performanceCheck) {
      result = result || this.performanceCheck();
    }
    if (checks.stakeAmountCheck) {
      result = result || this.checkStakeOnSnitch(checks.recipient);
    }
    if (checks.versionCheck) {
      result = result || this.checkProgramVersion();
    }
    if (this.status.value !== DELINQUENCY_STATUS) this.updateDelegationFactors();
    return result;
  }

  __flashloan(amount: uint64, receiver: Address): void {
    assert(this.txn.sender === this.creatorContractAppID.value.address, 'Caller must be the Vestguard Admin Contract');

    if (!this.balanceCheckpoint.exists) {
      this.balanceCheckpoint.value = this.app.address.balance;
    }
    sendPayment({
      receiver: receiver,
      amount: amount,
    });

    // top level Vestguard Admin checks that `checkBalance()` is called within the outer group before sending the flashloan txn
  }

  checkBalance(): void {
    assert(this.balanceCheckpoint.value === this.app.address.balance);
    this.balanceCheckpoint.delete();
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
    assert(
      this.app.address.balance >= globals.payoutsMinBalance && this.app.address.balance <= MAX_STAKE_PER_ACCOUNT,
      'Contract needs 30k Algo as minimum balance for rewards eligibility and at most 50M Algo'
    );
    assert(
      this.operatorCommit.value >= globals.payoutsMinBalance,
      'Operator commit must be higher than minimum balance for rewards eligibility'
    );

    if (this.status.value === DELINQUENCY_STATUS) {
      assert(
        this.delegatedStake.value === 0,
        'if Delinquent go Online only with your own stake to clear up delinquency'
      );
    }

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

    if (this.status.value !== DELINQUENCY_STATUS) {
      this.status.value = NEUTRAL_STATUS;
    }

    this.goOnlineEvent.log({
      app: this.app,
      operator: this.operatorAddress.value,
      operatorStake: this.operatorCommit.value,
      delegatedStake: this.delegatedStake.value,
    });
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
      'Only Node Operator or Vestguard Admin contract can set the contract offline'
    );
    sendOfflineKeyRegistration({});
    this.status.value = NOT_DELEGATABLE_STATUS;

    this.goOfflineEvent.log({
      app: this.app,
      operator: this.operatorAddress.value,
      operatorStake: this.operatorCommit.value,
      delegatedStake: this.delegatedStake.value,
    });
  }

  @abi.readonly
  getEligibilityFlag(): boolean {
    return this.app.address.incentiveEligible;
  }

  /**
   * Migrate the validator pool to a new pool. Useful to migrate this validator pool to a new version of the contract without losing the state.
   *
   * @param {AppID} newPool - ApplicationID of the new pool to migrate to
   */
  migrateToPool(newPool: AppID): void {
    assert(newPool.creator === this.app.creator, 'new pool has to be a pool created by the admin contract');
    assert(this.txn.sender === this.operatorAddress.value, 'only the operator can migrate to a new pool');
    assert(this.status.value !== DELINQUENCY_STATUS, 'cannot migrate if delinquent');

    sendMethodCall<typeof CaelusValidatorPool.prototype.__mergeStateOnMigration>({
      applicationID: newPool,
      methodArgs: [
        this.app,
        this.operatorCommit.value,
        this.operatorYieldAccrued.value,
        this.delegatedStake.value,
        this.performanceCounter.value,
        {
          receiver: newPool.address,
          amount: this.operatorCommit.value + this.delegatedStake.value + this.operatorYieldAccrued.value,
        },
        {
          xferAsset: this.tokenId.value,
          assetReceiver: newPool.address,
          assetAmount: this.app.address.assetBalance(this.tokenId.value),
        },
      ],
    });

    this.goOffline();
    this.operatorYieldAccrued.value = 0;
    this.operatorCommit.value = 0;
    this.delegatedStake.value = 0;
    this.performanceCounter.value = 0;
    this.updateDelegationFactors();
  }

  /**
   * FOLLOWUP OPERATION Receiving call from the old pool to merge the state into the new pool.
   */
  __mergeStateOnMigration(
    from: AppID,
    opCommit: uint64,
    opYieldAccrued: uint64,
    delegatedAmount: uint64,
    performanceCounter: uint64,
    stakeTxn: PayTxn,
    lstTxn: AssetTransferTxn
  ): void {
    const fromOp = from.globalState('operator') as Address;
    assert(
      this.txn.sender === from.address && fromOp === this.operatorAddress.value,
      'only the operator can initiate migration merge with proper method'
    );
    verifyPayTxn(stakeTxn, {
      receiver: this.app.address,
      amount: opCommit + delegatedAmount + opYieldAccrued,
    });
    verifyAssetTransferTxn(lstTxn, {
      xferAsset: this.tokenId.value,
      assetReceiver: this.app.address,
    });

    this.performanceCounter.value += performanceCounter;
    this.operatorCommit.value += opCommit;
    this.operatorYieldAccrued.value += opYieldAccrued;
    this.delegatedStake.value += delegatedAmount;

    this.updateDelegationFactors();
  }

  /**
   * Used by anyone to clear up remaining Algo outside of stake counters back to the Vestguard Admin contract to be redistributed
   */
  claimLeftAlgo(): void {
    const dust =
      this.app.address.balance -
      this.operatorCommit.value -
      this.operatorYieldAccrued.value -
      this.delegatedStake.value -
      this.app.address.minBalance;
    sendMethodCall<typeof CaelusAdmin.prototype.__onDustCollection>({
      applicationID: this.creatorContractAppID.value,
      methodArgs: [
        {
          receiver: this.creatorContractAppID.value.address,
          amount: dust,
        },
        this.app,
      ],
    });
  }

  /**
   * Node operator can close the Validator and get back his stake. Delegated stake is put back into the Vestguard Admin contract.
   */
  deleteApplication(): void {
    assert(this.status.value !== DELINQUENCY_STATUS, 'Account is delinquent. Solve Delinquency state before closing');
    assert(this.txn.sender === this.operatorAddress.value, 'Only the node operator can close the node');
    sendMethodCall<typeof CaelusAdmin.prototype.__cleanseOnValidatorDeletion>({
      applicationID: this.creatorContractAppID.value,
      methodArgs: [this.app],
    });
    this.purge();
    this.validatorCloseEvent.log({
      app: this.app,
      operator: this.operatorAddress.value,
      returnedStake: this.delegatedStake.value,
      operatorStake: this.operatorCommit.value,
    });
  }

  /**
   * SUBROUTINES
   */

  private performanceCheck(): boolean {
    // check if the account is eligible for incentives, otherwise it has been set offline by the protocol and needs to be put in delinquency
    if (!this.app.address.incentiveEligible) {
      this.setDelinquency();

      this.delinquencyEvent.log({
        app: this.app,
        operator: this.operatorAddress.value,
        stakeAtRisk: this.delegatedStake.value,
        delinquencyScore: this.delinquencyScore.value,
        status: this.status.value,
      });

      return true;
    }
    // check to not make performanceChecks be stacked in close proximity calls
    assert(
      globals.round - this.lastDelinquencyReport.value > this.getExpectedProposalsDelta() / 2,
      'Wait at least half the proposal expected time between Performance checks'
    );
    const deltaWithLatestProposal = globals.round - this.app.address.lastProposed;
    const isPerformingAsExpected = deltaWithLatestProposal < this.getExpectedProposalsDelta();
    const isPerformingAsTolerated = deltaWithLatestProposal < this.getToleratedProposalDelta();
    if (isPerformingAsExpected && isPerformingAsTolerated) {
      return false;
    }
    if (!isPerformingAsTolerated) {
      this.delinquencyScore.value += 5;
    } else if (!isPerformingAsExpected) {
      this.delinquencyScore.value +=
        this.lastDelinquencyReport.value > this.lastRewardReport.value || this.delinquencyScore.value > 5 ? 2 : 1;
    }
    this.setDelinquencyOnThresholdCheck();
    this.lastDelinquencyReport.value = globals.round;

    this.delinquencyEvent.log({
      app: this.app,
      operator: this.operatorAddress.value,
      stakeAtRisk: this.delegatedStake.value,
      delinquencyScore: this.delinquencyScore.value,
      status: this.status.value,
    });
    return true;
  }

  private checkStakeOnSnitch(recipient: AppID): boolean {
    const hasMoreThanMax = this.app.address.balance > MAX_STAKE_PER_ACCOUNT;
    if (hasMoreThanMax) this.updateDelegationFactors();
    const hasMoreThanDelegatable = this.saturationBuffer.value > BUFFER_MAX;
    if (hasMoreThanDelegatable) {
      const restake = this.delegatedStake.value - this.maxDelegatableStake.value;
      this.delegatedStake.value -= restake;

      sendMethodCall<typeof CaelusAdmin.prototype.reStakeFromSnitch>({
        applicationID: this.creatorContractAppID.value,
        methodArgs: [
          this.app,
          recipient,
          {
            receiver: this.creatorContractAppID.value.address,
            amount: restake,
          },
        ],
      });
    }

    return hasMoreThanMax || hasMoreThanDelegatable;
  }

  private checkProgramVersion(): boolean {
    const latestVersion = this.creatorContractAppID.value.globalState('validator_pool_version') as uint64;
    if (latestVersion === this.validatorPoolContractVersion.value) return false;
    this.purge();
    this.operatorCommit.value = 0;
    this.operatorYieldAccrued.value = 0;
    this.delegatedStake.value = 0;
    this.updateDelegationFactors();
    this.goOffline();
    return true;
  }

  private getGoOnlineFeeAmount(): uint64 {
    if (!this.getEligibilityFlag()) {
      return globals.payoutsGoOnlineFee;
    }
    return 0;
  }

  private setDelinquencyOnThresholdCheck(): void {
    if (!this.delinquencyThresholdCheck()) {
      this.setDelinquency();
    }
  }

  private delinquencyThresholdCheck(): boolean {
    if (this.delinquencyScore.value > MAX_DELINQUENCY_TOLERATED) {
      return false;
    }
    return true;
  }

  private setDelinquency(): void {
    assert(this.status.value !== DELINQUENCY_STATUS, 'Account already delinquent');
    const yieldAccrued = sendMethodCall<typeof CaelusAdmin.prototype.__onDelinquency, uint64>({
      applicationID: this.creatorContractAppID.value,
      methodArgs: [
        this.app,
        {
          xferAsset: this.tokenId.value,
          assetReceiver: this.creatorContractAppID.value.address,
          assetAmount: this.app.address.assetBalance(this.tokenId.value),
        },
      ],
    });
    sendPayment({
      receiver: this.creatorContractAppID.value.address,
      amount: this.delegatedStake.value,
    });
    this.delegatedStake.value = 0;
    this.performanceCounter.value = 0;
    this.updateDelegationFactors();
    this.status.value = DELINQUENCY_STATUS;
    this.operatorYieldAccrued.value = yieldAccrued;
  }

  private fixDelinquencyScore(): void {
    if (this.delinquencyScore.value === 0) {
      return;
    }
    if (this.status.value === DELINQUENCY_STATUS) {
      this.delinquencyScore.value -= 5;
    }
    this.delinquencyScore.value = 0;
  }

  private purge(): void {
    sendAssetTransfer({
      xferAsset: this.tokenId.value,
      assetReceiver: this.operatorAddress.value,
      assetCloseTo: this.operatorAddress.value,
      assetAmount: this.app.address.assetBalance(this.tokenId.value),
    });
    sendPayment({
      receiver: this.creatorContractAppID.value.address,
      amount: this.operatorCommit.value + this.delegatedStake.value,
      closeRemainderTo: this.creatorContractAppID.value.globalState('manager') as Address,
    });
  }

  private updateDelegationFactors(): void {
    let isDelinquent = false;
    if (this.status.value === DELINQUENCY_STATUS) {
      isDelinquent = true;
    }
    // start counting from the operator commit
    if (this.operatorCommit.value > globals.payoutsMinBalance) {
      this.maxDelegatableStake.value = this.operatorCommit.value;

      const tokenBoost = (this.getTier() * this.operatorCommit.value) / 2;
      this.maxDelegatableStake.value += tokenBoost;

      // add in the performance counter to increase delegatable amount, increases of 10k delegatable stake per multiples of 5 for performanceCounter
      this.maxDelegatableStake.value += PERFORMANCE_STAKE_INCREASE * (this.performanceCounter.value / PERFORMANCE_STEP);

      // check against globals.payoutsMaxBalance (50M)
      if (this.app.address.balance >= MAX_STAKE_PER_ACCOUNT) {
        this.maxDelegatableStake.value = 0;
        if (!isDelinquent) {
          this.status.value = NOT_DELEGATABLE_STATUS;
        }
      } else if (this.app.address.balance + this.maxDelegatableStake.value > MAX_STAKE_PER_ACCOUNT) {
        this.maxDelegatableStake.value = MAX_STAKE_PER_ACCOUNT - this.app.address.balance;
      }
    } else {
      this.maxDelegatableStake.value = 0;
      if (!isDelinquent) {
        this.status.value = NOT_DELEGATABLE_STATUS;
      }
    }

    // calculate saturation buffer with 3 decimal precision & set flag for delegation eligibility
    if (this.maxDelegatableStake.value > 0) {
      this.saturationBuffer.value = (this.delegatedStake.value * BUFFER_MAX) / this.maxDelegatableStake.value;
    } else {
      this.saturationBuffer.value = BUFFER_MAX; // When the maxDelegatableStake is 0, the saturation buffer is set to 1000
      if (!isDelinquent) {
        this.status.value = NOT_DELEGATABLE_STATUS;
      }
    }
    // ensure that delinquent accounts keep their status and their counters are zeroed
    if (isDelinquent) {
      this.maxDelegatableStake.value = 0;
      this.performanceCounter.value = 0;
      this.saturationBuffer.value = BUFFER_MAX;
    }
  }

  private getTier(): uint64 {
    let boostToken = AssetID.zeroIndex;
    if (!this.boostTokenID.exists) {
      this.boostTokenID.value = this.creatorContractAppID.value.globalState('boost_token_id') as AssetID;
    }
    boostToken = this.boostTokenID.value;
    if (boostToken === AssetID.zeroIndex) return 0;
    if (this.operatorAddress.value.isOptedInToAsset(boostToken)) return 0;
    const ownedToken = this.operatorAddress.value.assetBalance(boostToken);
    if (ownedToken === 0) return 0;
    const getTier = sendMethodCall<typeof CaelusAdmin.prototype.getBoostTier, uint64>({
      applicationID: this.creatorContractAppID.value,
      methodArgs: [ownedToken],
    });
    return getTier;
  }

  private getToleratedProposalDelta(): uint64 {
    return this.getExpectedProposalsDelta() * 3;
  }

  private getExpectedProposalsDelta(): uint64 {
    const currentOnlineStake = onlineStake();
    const currentAccountStake = this.app.address.voterBalance;
    const roundDelta = currentOnlineStake / currentAccountStake;
    return roundDelta * 20;
  }

  validatorCloseEvent = new EventLogger<{
    app: AppID;
    operator: Address;
    returnedStake: uint64;
    operatorStake: uint64;
  }>();

  goOnlineEvent = new EventLogger<{
    app: AppID;
    operator: Address;
    operatorStake: uint64;
    delegatedStake: uint64;
  }>();

  goOfflineEvent = new EventLogger<{
    app: AppID;
    operator: Address;
    operatorStake: uint64;
    delegatedStake: uint64;
  }>();

  operatorCommitUpdateEvent = new EventLogger<{
    app: AppID;
    operator: Address;
    amountAdded: uint64;
    amountRemoved: uint64;
  }>();

  delinquencyEvent = new EventLogger<{
    app: AppID;
    operator: Address;
    stakeAtRisk: uint64;
    delinquencyScore: uint64;
    status: uint64;
  }>();

  solvedDelinquencyEvent = new EventLogger<{
    app: AppID;
    operator: Address;
    stake: uint64;
  }>();

  rewardsEvent = new EventLogger<{
    app: AppID;
    block: uint64;
    payout: uint64;
  }>();

  snitchValidatorEvent = new EventLogger<{
    request: SnitchInfo;
    result: boolean;
  }>();
}
