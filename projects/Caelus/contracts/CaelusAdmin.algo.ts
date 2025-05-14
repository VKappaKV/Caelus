/* eslint-disable no-underscore-dangle */
/* eslint-disable consistent-return */
/* eslint-disable import/no-cycle */
import { Contract } from '@algorandfoundation/tealscript';
import { CaelusValidatorPool } from './CaelusValidator.algo';
import {
  ALGORAND_BASE_FEE,
  BURN_COOLDOWN,
  FLASH_LOAN_FEE,
  LOCKED,
  NEUTRAL_STATUS,
  PROTOCOL_COMMISSION,
  SCALE,
  UPDATABLE,
  VALIDATOR_POOL_CONTRACT_MBR,
  VEST_TIER_4,
  VEST_TIER_5,
} from './constants.algo';

/**
 * CaelusAdmin is the main contract handling the Caelus protocol. It acts as Factory contract by deploying the Validator
 * Contracts. It's also the creator of the LST and handles mint and burn functions.
 *
 * There are two key mechanisms in the protocol: bid and snitch.
 *
 * Both the bid and snitch are continous running auction leveraged to provide a priority queue to the protocol.
 *
 * Finally the Admin contract can be used to route a FlashLoan request using the Algo balance of the validators.
 */
export class CaelusAdmin extends Contract {
  programVersion = 11;

  manager = GlobalStateKey<Address>({ key: 'manager' });

  validatorPoolContractApprovalProgram = BoxKey<bytes>({
    key: 'validator_approval_program',
  });

  validatorPoolContractVersion = GlobalStateKey<uint64>({
    key: 'validator_pool_version',
  });

  validatorPoolContractCost = GlobalStateKey<uint64>({
    key: 'validator_pool_cost',
  });

  poolContractLock = GlobalStateKey<uint64>({
    key: 'pool_contract_lock_flag',
  });

  protocolFee = GlobalStateKey<uint64>({ key: 'protocol_fee' });

  totalStake = GlobalStateKey<uint64>({ key: 'total_stake' });

  pegRatio = GlobalStateKey<uint64>({ key: 'peg_ratio' });

  tokenId = GlobalStateKey<AssetID>({ key: 'token_id' });

  boostTokenID = GlobalStateKey<AssetID>({ key: 'boost_token_id' });

  tiers = GlobalStateKey<uint64[]>({ key: 'tiers' });

  tokenCirculatingSupply = GlobalStateKey<uint64>({
    key: 'circulating_supply',
  });

  highestBidder = GlobalStateKey<AppID>({ key: 'highest_bidder' });

  burnQueue = GlobalStateKey<StaticArray<AppID, 5>>({ key: 'burn_queue' });

  lastExhaustBlock = GlobalStateKey<uint64>({ key: 'last_exhaust_block' });

  lastFlashloanBlock = GlobalStateKey<uint64>({ key: 'last_flashloan_block' });

  flashLoanCounter = GlobalStateKey<uint64>({ key: 'flashloan_counter' });

  @allow.bareCreate('NoOp')
  createApplication(): void {
    this.manager.value = this.app.creator;
    this.validatorPoolContractVersion.value = 0;
    this.validatorPoolContractCost.value = VALIDATOR_POOL_CONTRACT_MBR;
    this.protocolFee.value = PROTOCOL_COMMISSION;

    this.totalStake.value = 0;
    this.pegRatio.value = 1 * SCALE;

    this.tokenId.value = AssetID.zeroIndex;
    this.tokenCirculatingSupply.value = 0;

    this.highestBidder.value = AppID.zeroIndex;

    this.burnQueue.value = [];

    this.tiers.value = [VEST_TIER_4, VEST_TIER_5];

    this.lastExhaustBlock.value = 0;
  }

  /**
   * Temporary method to update the application. This method will be removed in the future.
   * Here to improve open beta testing iterations. Planned to be removed on mainnet launch.
   */
  updateApplication(): void {
    assert(this.txn.sender === this.manager.value);
  }

  /**
   * MANAGER METHODS
   */

  MANAGER_createToken(): void {
    assert(this.txn.sender === this.manager.value, 'only the manager can call this method');

    if (this.tokenId.value === AssetID.zeroIndex) {
      this.tokenId.value = sendAssetCreation({
        configAssetTotal: 10 ** 16,
        configAssetDecimals: 6,
        configAssetReserve: this.app.address,
        configAssetManager: this.app.address,
        configAssetClawback: globals.zeroAddress,
        configAssetFreeze: globals.zeroAddress,
        configAssetDefaultFrozen: 0,
        configAssetName: 'Vestguard ALGO',
        configAssetUnitName: 'vALGO',
        configAssetURL: 'https://vestige.fi',
      });
    }
  }

  MANAGER_updateBoostTokenID(boostTokenID: AssetID): void {
    assert(this.txn.sender === this.manager.value, 'only the manager can call this method');
    this.boostTokenID.value = boostTokenID;
  }

  MANAGER_changeBoostTier(amounts: uint64[]): void {
    assert(this.txn.sender === this.manager.value, 'only the manager can call this method');
    this.tiers.value = amounts;
  }

  /**
   * The getBoostTier method is needed to be kept public so that on state update Validator Pool can fetch their current tier.
   * @param {uint64} amount  - The amount of the boost token to calculate the boost tier for
   * @returns {uint64} - The boost tier for the given amount
   */

  getBoostTier(amount: uint64): uint64 {
    if (amount < this.tiers.value[0]) return 0;
    for (let i = 0; i < this.tiers.value.length; i += 1) {
      if (amount < this.tiers.value[i]) return i + 1;
    }
    return this.tiers.value.length;
  }

  MANAGER_changeManager(manager: Address): void {
    assert(this.txn.sender === this.manager.value, 'only the manager can call this method');
    this.manager.value = manager;
  }

  MANAGER_changeProtocolFee(amount: uint64): void {
    assert(this.txn.sender === this.manager.value, 'only the manager can call this method');
    assert(amount <= 100, 'amount is meant as percentage, cannot be more than 100');
    this.protocolFee.value = amount;
  }

  MANAGER_lockContract(): void {
    assert(this.txn.sender === this.manager.value);
    this.poolContractLock.value = LOCKED;
  }

  MANAGER_updatePoolContractCost(validatorPoolContractCost: uint64): void {
    assert(this.txn.sender === this.manager.value, 'only the manager can call this method');
    this.validatorPoolContractCost.value = validatorPoolContractCost;
  }

  MANAGER_updatePoolContractProgram(programSize: uint64): void {
    assert(this.txn.sender === this.manager.value, 'only the manager can call this method');
    assert(this.poolContractLock.value === UPDATABLE, 'cannot rewrite contract anymore');

    if (this.validatorPoolContractApprovalProgram.exists) {
      this.validatorPoolContractApprovalProgram.resize(programSize);
    } else {
      this.validatorPoolContractApprovalProgram.create(programSize);
    }

    this.validatorPoolContractVersion.value += 1;
  }

  MANAGER_writePoolContractProgram(offset: uint64, data: bytes): void {
    assert(this.txn.sender === this.manager.value, 'only the manager can call this method');
    assert(this.poolContractLock.value === UPDATABLE, 'cannot rewrite contract anymore');

    this.validatorPoolContractApprovalProgram.replace(offset, data);
  }

  /**
   * ARC4 PUBLIC METHODS
   */

  /**
   * Factory method to spawn new Validator Pool Contracts.
   * @param {PayTxn} mbrPay - The MBR amount can vary depending on the version of the Validator Pool Contract. The mbrPay amount has to cover the cost of the Validator Pool Contract.
   */
  addValidator(mbrPay: PayTxn): void {
    verifyPayTxn(mbrPay, {
      receiver: this.app.address,
      amount: { greaterThanEqualTo: this.validatorPoolContractCost.value },
    });

    sendAppCall({
      onCompletion: OnCompletion.NoOp,
      approvalProgram: this.validatorPoolContractApprovalProgram.value,
      clearStateProgram: CaelusValidatorPool.clearProgram(),
      globalNumUint: CaelusValidatorPool.schema.global.numUint,
      globalNumByteSlice: CaelusValidatorPool.schema.global.numByteSlice,
      extraProgramPages: 3,
      applicationArgs: [
        method('createApplication(uint64,address,uint64,uint64)void'),
        itob(this.app.id),
        this.txn.sender,
        itob(this.validatorPoolContractVersion.value),
        itob(this.tokenId.value),
      ],
    });

    this.validatorAddedEvent.log({
      operator: this.txn.sender,
      version: this.validatorPoolContractVersion.value,
    });
  }

  /**
   * On Mint the Algo deposited by the user are kept in the Admin Contract Account balance waiting for the highest bidder to claim them.
   */
  mintRequest(mintTxn: PayTxn): void {
    verifyPayTxn(mintTxn, {
      receiver: this.app.address,
      amount: { greaterThanEqualTo: globals.minTxnFee },
    });

    const minted = this.getMintAmount(mintTxn.amount);
    this.doAxfer(this.txn.sender, minted, this.tokenId.value);
    this.totalStake.value += mintTxn.amount;
    this.tokenCirculatingSupply.value += minted;

    this.mintEvent.log({
      instant: true,
      amount: mintTxn.amount,
      output: minted,
    });
  }

  /**
   * On Burn the contract gradually checks where to take Algo from, first in the idle Admin balance, then from the burn queue.
   * In case the amount of Algo exceeds the current queue max amount the remaining vAlgo are sent back to the user.
   * This situation triggers the exhaust flag, that will prevent the contract from burning Algo for the next 5 blocks.
   * The Cooldown period is necessary to ensure that the queue is filled with the Validators more fit for the burn.
   * This to disallow possible spam looping of burning to target from specific pools.
   */
  burnRequest(burnTxn: AssetTransferTxn, burnTo: Address): void {
    verifyAssetTransferTxn(burnTxn, {
      xferAsset: this.tokenId.value,
      assetReceiver: this.app.address,
      assetAmount: { greaterThanEqualTo: ALGORAND_BASE_FEE },
    });

    const amountToBurn = this.getBurnAmount(burnTxn.assetAmount);
    let burning = 0;

    const idleAlgo = this.app.address.balance - this.app.address.minBalance;
    if (idleAlgo > 0) {
      const amountToBurnFromIdle = idleAlgo >= amountToBurn ? amountToBurn : idleAlgo;
      burning += amountToBurnFromIdle;

      sendPayment({
        receiver: burnTxn.sender,
        amount: amountToBurnFromIdle,
      });
    }

    if (burning === amountToBurn) {
      this.downSupplyCounters(amountToBurn, burnTxn.assetAmount);
      this.burnEvent.log({
        filled: true,
        amount: burnTxn.assetAmount,
        output: burning,
      });
      return;
    }

    if (this.queueIsEmpty()) {
      const amountLeft = this.getMintAmount(amountToBurn - burning);
      this.doAxfer(burnTxn.sender, amountLeft, this.tokenId.value);
      this.downSupplyCounters(burning, burnTxn.assetAmount - amountLeft);
      this.burnEvent.log({
        filled: false,
        amount: burnTxn.assetAmount - amountLeft,
        output: burning,
      });
      return;
    }

    if (!this.queueIsFull()) {
      assert(globals.round - this.lastExhaustBlock.value > BURN_COOLDOWN, 'wait at least 5 blocks since Exhaust Block');
    }

    const queue = clone(this.burnQueue.value);
    for (let i = 0; i < queue.length; i += 1) {
      const app = queue[i];
      if (this.isPool(app)) {
        const delegatedToTarget = app.globalState('delegated_stake') as uint64;
        if (delegatedToTarget < amountToBurn - burning) {
          this.doBurnTxn(app, [delegatedToTarget, burnTo]);
          this.burnQueue.value[i] = AppID.zeroIndex;
          burning += delegatedToTarget;
        } else {
          this.doBurnTxn(app, [amountToBurn - burning, burnTo]);
          burning = amountToBurn;
        }
      }
    }

    const amountLeft = this.getMintAmount(amountToBurn - burning);
    if (amountLeft > 0) {
      this.doAxfer(burnTxn.sender, amountLeft, this.tokenId.value);
      this.lastExhaustBlock.value = globals.round;
    }

    this.downSupplyCounters(burning, burnTxn.assetAmount - amountLeft);

    this.burnEvent.log({
      filled: amountLeft > 0,
      amount: burnTxn.assetAmount - amountLeft,
      output: burning,
    });
  }

  /**
   * Specific method to mint the LST for the Validator Pool Contract.
   * The mint is done by the Admin Contract and the LST is sent to the Validator Pool Contract.
   */
  mintValidatorCommit(validatorAppID: AppID, stakeCommit: PayTxn): void {
    assert(this.isPool(validatorAppID));
    const operatorAddress = validatorAppID.globalState('operator') as Address;
    verifyPayTxn(stakeCommit, {
      sender: operatorAddress,
      receiver: this.app.address,
    });

    sendMethodCall<typeof CaelusValidatorPool.prototype.__addToOperatorCommit>({
      applicationID: validatorAppID,
      methodArgs: [
        {
          receiver: validatorAppID.address,
          amount: stakeCommit.amount,
        },
      ],
    });

    const amountToMint = this.getMintAmount(stakeCommit.amount);
    this.doAxfer(validatorAppID.address, amountToMint, this.tokenId.value);
    this.upSupplyCounters(stakeCommit.amount, amountToMint);
  }

  /**
   * Specific method to remove from the operator commit in the Validator Pool Contract.
   *
   * The Validator Pool Contract will send the vAlgo to the operator address.
   */
  removeValidatorCommit(appToBurnFrom: AppID, amount: uint64): void {
    this.isPool(appToBurnFrom);
    verifyTxn(this.txn, {
      sender: appToBurnFrom.globalState('operator') as Address,
    });
    const toBurn = this.getBurnAmount(amount);

    sendMethodCall<typeof CaelusValidatorPool.prototype.__removeFromOperatorCommit, void>({
      applicationID: appToBurnFrom,
      methodArgs: [toBurn, amount],
    });

    this.tokenCirculatingSupply.value -= amount;
  }

  /**
   * FOLLOWUP OPERATION CALLED BY THE VALIDATOR POOL CONTRACT EITHER ON DELINQUENCY OR ON SNITCH
   *
   * On Delinquency Validators SHOULD not have vAlgo in their balance.
   * It's first called when deliquency is set, can be called again if the entire vAlgo amount is not burned.
   * The vAlgo will be turned to Algo and added to the operator commit
   */
  __burnToDelinquentValidator(burnTxn: AssetTransferTxn, validatorAppID: AppID, amountOperator: uint64): void {
    assert(this.isPool(validatorAppID) && this.txn.sender === validatorAppID.address);
    let amountToUpdate: uint64 = 0; // the ASA amount to give back if the burn request isnt filled && then reduce circ supply
    let toBurn: uint64 =
      this.getBurnAmount(burnTxn.assetAmount) - (validatorAppID.globalState('operator_commit') as uint64); // burn from other validators the amount of Algo accrued from the operator LST
    let amtBurned = 0; // need this to subtract from totalAlgoSupply
    const queue = clone(this.burnQueue.value);
    for (let i = 0; i < queue.length; i += 1) {
      const currentTargetInQueue = queue[i];
      if (this.isPool(currentTargetInQueue)) {
        const delegatedToTarget = currentTargetInQueue.globalState('delegated_stake') as uint64;
        if (delegatedToTarget >= toBurn) {
          this.doBurnTxn(currentTargetInQueue, [toBurn, this.app.address]);
          amtBurned += toBurn;
          toBurn = 0;
          break;
        } else {
          this.doBurnTxn(currentTargetInQueue, [delegatedToTarget, this.app.address]);
          amtBurned += delegatedToTarget;
          toBurn -= delegatedToTarget;
          this.burnQueue.value[i] = AppID.zeroIndex;
        }
      }
    }
    amountToUpdate = this.getBurnAmount(toBurn - amtBurned);

    this.downSupplyCounters(amtBurned + amountOperator, burnTxn.assetAmount - amountToUpdate);

    if (amountToUpdate > 0) {
      this.doAxfer(burnTxn.sender, amountToUpdate, this.tokenId.value);
    }
    sendMethodCall<typeof CaelusValidatorPool.prototype.__addToOperatorCommit>({
      applicationID: validatorAppID,
      methodArgs: [
        {
          receiver: validatorAppID.address,
          amount: amtBurned,
        },
      ],
    });

    this.burnEvent.log({
      filled: amountToUpdate > 0,
      amount: burnTxn.assetAmount,
      output: amtBurned,
    });
  }

  /**
   * FOLLOWUP OPERATION CALLED BY THE VALIDATOR POOL CONTRACT WHEN DELINQUENCY IS SOLVED
   *
   * When Delinquency is solved the operator will mint his commit back into vAlgo.
   */
  __reMintDelinquentCommit(app: AppID): void {
    assert(this.isPool(app) && this.txn.sender === app.address);
    const amount = app.globalState('operator_commit') as uint64;
    const amountToMint = this.getMintAmount(amount);
    this.doAxfer(app.address, amountToMint, this.tokenId.value);

    this.upSupplyCounters(amount, amountToMint);

    this.mintEvent.log({
      instant: true,
      amount: amount,
      output: amountToMint,
    });
  }

  /**
   * Bid Validator App, highest bidder should have the lowest saturation buffer value.
   */
  bid(validatorAppID: AppID): void {
    assert(this.isPool(validatorAppID));
    const isOnLatestVersion =
      (validatorAppID.globalState('contract_version') as uint64) === this.validatorPoolContractVersion.value;
    assert(isOnLatestVersion, 'cannot bid if not on latest version');
    const isDelegatable = (validatorAppID.globalState('status') as uint64) === NEUTRAL_STATUS;
    assert(isDelegatable, 'only bid delegatable Apps');
    if (!this.isPool(this.highestBidder.value)) {
      this.highestBidder.value = validatorAppID;
      this.bidEvent.log({
        app: validatorAppID,
        isHeighest: this.highestBidder.value === validatorAppID,
      });
      return;
    }
    if ((this.highestBidder.value.globalState('status') as uint64) !== NEUTRAL_STATUS) {
      this.highestBidder.value = validatorAppID;
      this.bidEvent.log({
        app: validatorAppID,
        isHeighest: this.highestBidder.value === validatorAppID,
      });
      return;
    }
    const challengerBuffer = validatorAppID.globalState('saturation_buffer') as uint64;
    const highestBuffer = this.highestBidder.value.globalState('saturation_buffer') as uint64;
    if (challengerBuffer > highestBuffer) {
      this.highestBidder.value = validatorAppID;
    }

    this.bidEvent.log({
      app: validatorAppID,
      isHeighest: this.highestBidder.value === validatorAppID,
    });
  }

  /**
   * The method is called by the Validator Pool Contract to declare the rewards.
   *
   * It doesn't utilize stricter checks on call since as long as the rewardPay is sent to the Admin contract we welcome free money to the protocol >:)
   * There's no other state getting changed aside from the totalStake
   */
  declareRewards(proposer: AppID, block: uint64, rewardPay: PayTxn): void {
    assert(blocks[block].proposer === proposer.address);
    assert(rewardPay.receiver === this.app.address);
    const amount = rewardPay.amount - wideRatio([this.protocolFee.value, rewardPay.amount], [100]);
    this.totalStake.value += amount;
    this.upSupplyCounters(amount, 0);
  }

  // called to send the Algo used to mint vALGO to the highest bidder
  delegateStake(amount: uint64): void {
    assert(this.isPool(this.highestBidder.value));
    assert(this.highestBidder.value.globalState('status') === NEUTRAL_STATUS);
    if (this.txn.sender === (this.highestBidder.value.globalState('operator') as Address)) {
      sendMethodCall<typeof CaelusValidatorPool.prototype.__addStake, void>({
        applicationID: this.highestBidder.value,
        methodArgs: [
          {
            receiver: this.highestBidder.value.address,
            amount: amount,
          },
        ],
      });
    } else {
      const maxDelegatable = this.highestBidder.value.globalState('max_delegatable') as uint64;
      const delegatedStake = this.highestBidder.value.globalState('delegated_stake') as uint64;
      assert(delegatedStake + amount <= maxDelegatable, 'amount exceeds max delegatable');
      sendMethodCall<typeof CaelusValidatorPool.prototype.__addStake, void>({
        applicationID: this.highestBidder.value,
        methodArgs: [
          {
            receiver: this.highestBidder.value.address,
            amount: amount,
          },
        ],
      });
    }
  }

  /**
   * Push new Validator App to the burn queue. If the saturation buffer is higher than the current lowest in the queue, the new App will be snitched.
   */
  snitchToBurn(app: AppID): void {
    assert(this.isPool(app));
    const satSnitch = app.globalState('saturation_buffer') as uint64;
    let minPrio = app;
    let minSat = satSnitch;

    const queue = clone(this.burnQueue.value);
    for (let i = 0; i < queue.length; i += 1) {
      if (!this.isPool(queue[i])) {
        queue[i] = minPrio;
        break;
      }
      if ((queue[i].globalState('saturation_buffer') as uint64) < minSat) {
        const temp = minPrio;
        minPrio = queue[i];
        minSat = queue[i].globalState('saturation_buffer') as uint64;
        queue[i] = temp;
      }
    }

    this.burnQueue.value = queue;

    this.snitchQueueEvent.log({
      queue: this.burnQueue.value,
    });
  }

  multiSnitchToBurn(apps: AppID[]): void {
    for (let i = 0; i < apps.length; i += 1) {
      const appToSnitch = apps[i];
      this.snitchToBurn(appToSnitch);
    }
  }

  /**
   * Follow up operation called by the snitched App to perform restaking of the delegated Algo clawed back
   *
   * @param {AppID} snitchedApp - The AppID of the validator to snitch
   * @param {AppID} receiverApp - The AppID of the receiver of the delegated Algo
   * @param {PayTxn} restakeTxn - The PayTxn following the snitch that sends the delegated Algo to be moved back and restaked
   */
  reStakeFromSnitch(snitchedApp: AppID, receiverApp: AppID, restakeTxn: PayTxn): void {
    assert(
      this.isPool(snitchedApp) && this.txn.sender === snitchedApp.address,
      'only the snitched app can initiate this method'
    );
    assert(this.isPool(receiverApp) || receiverApp === this.app, 'receiver must be a pool or the admin');
    verifyPayTxn(restakeTxn, {
      sender: snitchedApp.address,
      receiver: this.app.address,
    });
    if (receiverApp !== this.app) {
      sendMethodCall<typeof CaelusValidatorPool.prototype.__addStake, void>({
        applicationID: receiverApp,
        methodArgs: [
          {
            receiver: receiverApp.address,
            amount: restakeTxn.amount,
          },
        ],
      });
    }
  }

  /**
   * Algo balances in the Validator Pool Contracts sit idle, but can be efficiently use for flashloans.
   * This creates a new route of revenue for the protocol.
   * The method checks that each flashloan call is repaid through the subsequent checkBalance method call.
   *
   * @param {PayTxn} payFeeTxn - FlashLoan fee payment; the fee is flat and grows with demand for the flashloan service
   * @param {uint64[]} amounts - The amount of Algo to take from each app, the value has to be correlated to the app in the appToInclude array at the same index
   * @param {AppID} appToInclude - The AppID of the Validator Pool Contracts to execute the flashloan request on
   */
  makeFlashLoanRequest(payFeeTxn: PayTxn, amounts: uint64[], appToInclude: AppID[]): void {
    this.getFLcounter();
    this.flashLoanCounter.value += appToInclude.length;
    const keepFee = this.flashLoanCounter.value + FLASH_LOAN_FEE;

    verifyPayTxn(payFeeTxn, {
      receiver: this.app.address,
      amount: { greaterThanEqualTo: keepFee },
    });

    assert(amounts.length === appToInclude.length, 'array length [amount, appToInclude] mismatch');
    for (let i = 0; i < appToInclude.length; i += 1) {
      sendMethodCall<typeof CaelusValidatorPool.prototype.__flashloan, void>({
        applicationID: appToInclude[i],
        methodArgs: [amounts[i], this.txn.sender],
      });

      for (let j = this.txn.groupIndex; j < this.txnGroup.length; j += 1) {
        const txn = this.txnGroup[j];
        let repaid = false;
        if (
          txn.typeEnum === TransactionType.ApplicationCall &&
          txn.applicationID === appToInclude[i] &&
          txn.onCompletion === 0 &&
          txn.numAppArgs === 1 &&
          txn.applicationArgs[0] === method('checkBalance():void')
        ) {
          repaid = true;
        }
        assert(repaid, 'flashloan not repaid');
      }
    }
    this.flashLoanEvent.log({ apps: appToInclude, amounts: amounts });
  }

  @abi.readonly
  getFLcounter(): uint64 {
    if (!this.flashLoanCounter.exists) {
      this.flashLoanCounter.value = 0;
    }
    if (this.lastFlashloanBlock.value === globals.round) {
      return this.flashLoanCounter.value;
    }
    const reduce = globals.round - this.lastFlashloanBlock.value;
    if (reduce > this.flashLoanCounter.value) {
      this.flashLoanCounter.value = 0;
      return this.flashLoanCounter.value;
    }
    this.flashLoanCounter.value -= reduce * 2 > this.flashLoanCounter.value ? reduce * 2 : reduce;
    return this.flashLoanCounter.value;
  }

  @abi.readonly
  arc62_get_circulating_supply(assetId: AssetID): uint64 {
    assert(assetId === this.tokenId.value, 'invalid asset id');
    return this.tokenCirculatingSupply.value;
  }

  /**
   * SUBROUTINES
   */

  private calculateLSTRatio(): void {
    if (this.tokenCirculatingSupply.value === 0) {
      return;
    }
    this.pegRatio.value = wideRatio([this.totalStake.value, SCALE], [this.tokenCirculatingSupply.value]);
  }

  private getMintAmount(amount: uint64): uint64 {
    this.calculateLSTRatio();
    return wideRatio([amount, SCALE], [this.pegRatio.value]);
  }

  private getBurnAmount(amount: uint64): uint64 {
    this.calculateLSTRatio();
    return wideRatio([amount, this.pegRatio.value], [SCALE]);
  }

  private upSupplyCounters(stake: uint64, supply: uint64): void {
    this.totalStake.value += stake;
    this.tokenCirculatingSupply.value += supply;
  }

  private downSupplyCounters(stake: uint64, supply: uint64): void {
    this.totalStake.value -= stake;
    this.tokenCirculatingSupply.value -= supply;
  }

  private doBurnTxn(target: AppID, args: [uint64, Address]): void {
    sendMethodCall<typeof CaelusValidatorPool.prototype.__burnStake, void>({
      applicationID: target,
      methodArgs: [args[0], args[1]],
    });
  }

  private doAxfer(receiver: Address, amount: uint64, asset: AssetID): void {
    sendAssetTransfer({
      assetReceiver: receiver,
      assetAmount: amount,
      xferAsset: asset,
    });
  }

  private isPool(app: AppID): boolean {
    return app.creator === this.app.address;
  }

  private queueIsEmpty(): boolean {
    const queue = clone(this.burnQueue.value);
    for (let i = 0; i < queue.length; i += 1) {
      if (queue[i] !== AppID.zeroIndex) {
        return false;
      }
    }
    return true;
  }

  private queueIsFull(): boolean {
    const queue = clone(this.burnQueue.value);
    for (let i = 0; i < queue.length; i += 1) {
      if (queue[i] === AppID.zeroIndex) {
        return false;
      }
    }
    return true;
  }

  validatorAddedEvent = new EventLogger<{
    operator: Address;
    version: uint64;
  }>();

  mintEvent = new EventLogger<{
    instant: boolean;
    amount: uint64;
    output: uint64;
  }>();

  burnEvent = new EventLogger<{
    filled: boolean;
    amount: uint64;
    output: uint64;
  }>();

  bidEvent = new EventLogger<{
    app: AppID;
    isHeighest: boolean;
  }>();

  snitchQueueEvent = new EventLogger<{
    queue: StaticArray<AppID, 5>;
  }>();

  flashLoanEvent = new EventLogger<{
    apps: AppID[];
    amounts: uint64[];
  }>();
}
