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
 * Caelus Validator Pool Contract is the contract account participating in the consensus protocol and receiver of the delegated stake.
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
   * TODO UPDATE
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
    this.delegatedStake.value = 0;
    this.maxDelegatableStake.value = 0;

    // init buffer, flags & counters
    this.status.value = NOT_DELEGATABLE_STATUS;
    this.saturationBuffer.value = 0;
    this.performanceCounter.value = 0;
    this.delinquencyScore.value = 0;

    this.repaid.value = true;
  }

  optIntoLST(): void {
    verifyTxn(this.txn, {
      sender: this.operatorAddress.value,
    });

    assert(!this.app.address.isOptedInToAsset(this.tokenId.value), 'already opted in tokenId');

    const lst = this.creatorContractAppID.value.globalState('token_id') as AssetID;

    sendAssetTransfer({
      assetReceiver: this.app.address,
      xferAsset: lst,
      assetAmount: 0,
    });
  }

  /**
   *  Used by the Caelus Admin to send the correct amount into the operator commit
   *
   * @param {PayTxn} opStake - node operator stake commitment
   */
  addToOperatorCommit(opStake: PayTxn): void {
    assert(
      this.txn.sender === this.creatorContractAppID.value.address,
      'only Caelus admin can route operator stake without LST'
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
   * @param {uint64} claimRequest - amount claimed by the node operator to be removed from the contract balance and subtracted from the operator_commit counter
   * @throws {Error} if the sender isn't the node operator or if the total commit by the node operator goes below the min threshold for rewards eligibility
   */
  removeFromOperatorCommit(claimRequest: uint64, claimRequestLST: uint64): void {
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

  // call this method if Account has been flagged as delinquent wait fixed amount of time before resetting it and expects payment if necessary (?)
  solveDelinquency(block: uint64): void {
    assert(this.status.value !== DELINQUENCY_STATUS, 'Account is not delinquent');
    assert(this.txn.sender === this.operatorAddress.value, 'Only the Node Operator can clear up Delinquency');
    assert(
      this.delegatedStake.value === 0,
      'Before clearing up delinquency all the delegated stake must be redistributed'
    );
    assert(blocks[block].proposer === this.app.address, 'the solving block must be proposed by this account');
    assert(this.lastDelinquencyReport.value < block); // validator has to win a proposal sooner than latest delinquency report to clear up delinquency
    assert(this.delinquencyThresholdCheck(), 'Delinquency score must be below threshold');
    this.status.value = NEUTRAL_STATUS;
    this.updateDelegationFactors();
    sendMethodCall<typeof CaelusAdmin.prototype.reMintDelinquentCommit, void>({
      applicationID: this.creatorContractAppID.value,
      methodArgs: [this.app],
    });

    this.solvedDelinquencyEvent.log({
      app: this.app,
      operator: this.operatorAddress.value,
      stake: this.operatorCommit.value,
    });
  }

  // In a hypothetical where a block proposer proposed two blocks s/he should always report the blocks from the oldest block first. We should do this in the SDK.
  // No loss of funds if this doesn't happen, but they don't end up recorded as rewards, instead going to the dust fund.
  reportRewards(block: uint64): void {
    assert(blocks[block].proposer === this.app.address); // NOTE THAT IN SDK WHEN CRAFTING TXN BLOCK NEEDS TO BE INCLUDED IN FIRST VALID TO NOW RANGE
    assert(block > this.lastRewardReport.value);
    const isOperatorReportTime = globals.round - block < OPERATOR_REPORT_MAX_TIME;
    const report = blocks[block].proposerPayout;
    const takeFee = wideRatio([report, VALIDATOR_COMMISSION], [100]);

    if (this.getToleratedProposalDelta() < globals.round - this.lastRewardReport.value) {
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

  // called by the auction contract to assign stake to the node contract
  addStake(txnWithStake: PayTxn): void {
    verifyPayTxn(txnWithStake, {
      sender: this.creatorContractAppID.value.address,
      receiver: this.app.address,
    });
    this.delegatedStake.value += txnWithStake.amount;
    this.updateDelegationFactors();
  }

  // called by the auction contract at burn
  burnStake(amountRequested: uint64, receiverBurn: Address): void {
    assert(
      this.txn.sender === this.creatorContractAppID.value.address,
      'Only the Caelus Admin contract can call this method'
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

  // calls to another Validator getSnitched method. If successfull it will increase performanceCounter
  snitchValidator(appToSnitch: AppID, params: SnitchInfo): void {
    assert(this.status.value !== DELINQUENCY_STATUS);
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
      result = result || this.checkStakeOnSnitch(checks.recipient, checks.split, checks.max);
    }
    if (checks.delinquentCheck) {
      result = result || this.checkDelinquencyOnSnitch();
    }
    if (checks.versionCheck) {
      result = result || this.checkProgramVersion();
    }
    if (this.status.value !== DELINQUENCY_STATUS) this.updateDelegationFactors();
    return result;
  }

  flashloan(amount: uint64, receiver: Address): void {
    if (this.repaid.value) {
      this.balanceCheckpoint.value = this.app.address.balance;
      this.repaid.value = false;
    }
    assert(this.txn.sender === this.creatorContractAppID.value.address, 'Caller must be the Caelus Admin Contract');

    sendPayment({
      receiver: receiver,
      amount: amount,
    });

    // top level Caelus Admin checks that checkBalance is called within the outer group before sending the flashloan txn
  }

  checkBalance(): void {
    assert(this.balanceCheckpoint.value === this.app.address.balance);
    this.repaid.value = true;
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

    // Check that contract balance is at least 30k Algo and less than MAX_STAKE_PER_ACCOUNT
    assert(
      this.app.address.balance >= globals.payoutsMinBalance && this.app.address.balance <= MAX_STAKE_PER_ACCOUNT,
      'Contract needs 30k Algo as minimum balance for rewards eligibility and at most 50M Algo'
    );

    // Check that operator commit to the contract balance is at least 30k Algo
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
      'Only Node Operator or Caelus Admin contract can set the contract offline'
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

  private performanceCheck(): boolean {
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
    const isPerformingAsExpected = this.getExpectedProposalsDelta() > deltaWithLatestProposal;
    const isPerformingAsTolerated = this.getToleratedProposalDelta() > deltaWithLatestProposal;
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

  migrateToPool(newPool: AppID): void {
    assert(newPool.creator === this.app.creator, 'new pool has to be a pool created by the admin contract');
    assert(this.txn.sender === this.operatorAddress.value, 'only the operator can migrate to a new pool');
    assert(this.status.value === DELINQUENCY_STATUS, 'cannot migrate if delinquent');

    sendMethodCall<typeof CaelusValidatorPool.prototype.mergeStateOnMigration>({
      applicationID: newPool,
      methodArgs: [
        this.app,
        this.operatorCommit.value,
        this.delegatedStake.value,
        this.performanceCounter.value,
        { receiver: newPool.address, amount: this.operatorCommit.value + this.delegatedStake.value },
        {
          xferAsset: this.tokenId.value,
          assetReceiver: newPool.address,
          assetAmount: this.app.address.assetBalance(this.tokenId.value),
        },
      ],
    });
  }

  mergeStateOnMigration(
    from: AppID,
    opCommit: uint64,
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
      amount: opCommit + delegatedAmount,
    });
    verifyAssetTransferTxn(lstTxn, {
      xferAsset: this.tokenId.value,
      assetReceiver: this.app.address,
    });

    this.performanceCounter.value += performanceCounter;
    this.operatorCommit.value += opCommit;
    this.delegatedStake.value += delegatedAmount;

    this.updateDelegationFactors();
  }

  // used by anyone to clear up remaining Algo outside of stake counters
  claimLeftAlgo(): void {
    const dust =
      this.app.address.balance - this.operatorCommit.value - this.delegatedStake.value - this.app.address.minBalance;
    const manager = this.creatorContractAppID.value.globalState('manager') as Address;
    sendPayment({
      receiver: manager,
      amount: dust,
    });
  }

  deleteApplication(): void {
    assert(this.status.value !== DELINQUENCY_STATUS, 'Account is delinquent. Solve Delinquency state before closing');
    assert(this.txn.sender === this.operatorAddress.value, 'Only the node operator can close the node');
    this.purge();
    this.validatorCloseEvent.log({
      app: this.app,
      operator: this.operatorAddress.value,
      returnedStake: this.delegatedStake.value,
      operatorStake: this.operatorCommit.value,
    });
  }

  private checkStakeOnSnitch(recipient: AppID, split: boolean, max: uint64): boolean {
    const hasMoreThanMax = this.app.address.balance > MAX_STAKE_PER_ACCOUNT;
    if (hasMoreThanMax) this.setDelinquency();
    const hasMoreThanDelegatable = this.saturationBuffer.value > BUFFER_MAX;
    if (hasMoreThanDelegatable) {
      const amount = this.delegatedStake.value - this.maxDelegatableStake.value;
      this.delegatedStake.value -= amount;
      const reStakeAmount = split ? amount - max : amount;
      sendMethodCall<typeof CaelusAdmin.prototype.reStakeFromSnitch>({
        applicationID: this.creatorContractAppID.value,
        methodArgs: [
          this.app,
          recipient,
          {
            receiver: this.creatorContractAppID.value.address,
            amount: reStakeAmount,
          },
        ],
      });
      if (amount - max > 0)
        sendMethodCall<typeof CaelusAdmin.prototype.reStakeFromSnitch>({
          applicationID: this.creatorContractAppID.value,
          methodArgs: [
            this.app,
            this.creatorContractAppID.value,
            {
              receiver: this.creatorContractAppID.value.address,
              amount: amount - max,
            },
          ],
        });
    }

    return hasMoreThanMax || hasMoreThanDelegatable;
  }

  private checkDelinquencyOnSnitch(): boolean {
    if (this.status.value !== DELINQUENCY_STATUS) return false;
    if (this.app.address.assetBalance(this.tokenId.value) === 0) return false;
    sendMethodCall<typeof CaelusAdmin.prototype.burnToDelinquentValidator>({
      applicationID: this.creatorContractAppID.value,
      methodArgs: [
        {
          xferAsset: this.tokenId.value,
          assetReceiver: this.creatorContractAppID.value.address,
          assetAmount: this.app.address.assetBalance(this.tokenId.value),
        },
        this.app,
        0, // must be kept 0 because the operator commit is already removed from the TotalStake on setDelinquency, this is a follow up call to ensure all his LST balance have been burned
      ],
    });
    return true;
  }

  private checkProgramVersion(): boolean {
    const latestVersion = this.creatorContractAppID.value.globalState('validator_pool_version') as uint64;
    if (latestVersion === this.validatorPoolContractVersion.value) return false;
    this.purge();
    this.operatorCommit.value = 0;
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
    sendMethodCall<typeof CaelusAdmin.prototype.burnToDelinquentValidator>({
      applicationID: this.creatorContractAppID.value,
      methodArgs: [
        {
          xferAsset: this.tokenId.value,
          assetReceiver: this.creatorContractAppID.value.address,
          assetAmount: this.app.address.assetBalance(this.tokenId.value),
        },
        this.app,
        this.operatorCommit.value,
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
    assert(
      this.status.value !== DELINQUENCY_STATUS,
      'Account is delinquent. Solve Delinquency state before updating parameters'
    );
    // start counting from the operator commit
    if (this.operatorCommit.value > globals.payoutsMinBalance && this.status.value === 0) {
      this.maxDelegatableStake.value = this.operatorCommit.value;

      const tokenBoost = (this.getTier() * this.operatorCommit.value) / 2;
      this.maxDelegatableStake.value += tokenBoost;

      // add in the performance counter to increase delegatable amount, increases of 10k delegatable stake per multiples of 5 for performanceCounter
      this.maxDelegatableStake.value += PERFORMANCE_STAKE_INCREASE * (this.performanceCounter.value / PERFORMANCE_STEP);

      // check against globals.payoutsMaxBalance (50M)
      if (this.app.address.balance >= MAX_STAKE_PER_ACCOUNT) {
        this.maxDelegatableStake.value = 0;
        this.setDelinquency();
      } else if (this.app.address.balance + this.maxDelegatableStake.value > MAX_STAKE_PER_ACCOUNT) {
        this.maxDelegatableStake.value = MAX_STAKE_PER_ACCOUNT - this.app.address.balance;
      }
    } else {
      this.maxDelegatableStake.value = 0;
    }

    // calculate saturation buffer with 3 decimal precision & set flag for delegation eligibility
    if (this.maxDelegatableStake.value > 0) {
      this.saturationBuffer.value = (this.delegatedStake.value * BUFFER_MAX) / this.maxDelegatableStake.value;
    } else {
      this.saturationBuffer.value = BUFFER_MAX;
      this.status.value = NOT_DELEGATABLE_STATUS;
    }
  }

  private getTier(): uint64 {
    if (!this.boostTokenID.exists) {
      this.creatorContractAppID.value.globalState('boost_token_id') as AssetID;
    }
    const ownedToken = this.operatorAddress.value.assetBalance(this.boostTokenID.value);
    if (ownedToken === 0) return 0;
    const getTier = sendMethodCall<typeof CaelusAdmin.prototype.getBoostTier, uint64>({
      applicationID: this.creatorContractAppID.value,
      methodArgs: [ownedToken],
    });
    return getTier;
  }

  // Let's check the params, probably talk to either nullun or AF, before going live cause of probabilistic nature of ALGO.
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
