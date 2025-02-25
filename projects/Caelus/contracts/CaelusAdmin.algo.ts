/* eslint-disable import/no-cycle */
import { Contract } from '@algorandfoundation/tealscript';
import { CaelusValidatorPool } from './CaelusValidator.algo';
import { Values, SnitchInfo, StateKeys } from './constants.algo';

/**
 * CaelusAdmin is the main contract handling the Caelus protocol. It acts as Factory contract by deploying the Validator
 * Contracts. It's also the creator of the LST and handles mint and burn functions.
 *
 * There are two key mechanisms in the protocol: bid and snitch.
 *
 * Both the bid and snitch are continous running auction leveraged to provide a priority queue to the protocol.
 * Anyone can then call the contract to execute a snitch check on a Validator, this is used to verify the correct behavior
 * of the Validator contract, whatever it is participating correctly or other things.
 *
 * Finally the Admin contract can be used to route a FlashLoan request, this type of atomic group call asserts that the
 * balance of each contract touched is brought back at the start of each operation.
 */
export class CaelusAdmin extends Contract {
  programVersion = 11;

  manager = GlobalStateKey<Address>({ key: StateKeys.MANAGER });

  validatorPoolContractApprovalProgram = BoxKey<bytes>({
    key: StateKeys.VALIDATOR_POOL_APPROVAL_PROGRAM,
  });

  validatorPoolContractVersion = GlobalStateKey<uint64>({
    key: StateKeys.VALIDATOR_POOL_CONTRACT_VERSION,
  });

  validatorPoolContractCost = GlobalStateKey<uint64>({
    key: StateKeys.VALIDATOR_POOL_CONTRACT_COST,
  });

  totalStake = GlobalStateKey<uint64>({ key: StateKeys.TOTAL_STAKE });

  pegRatio = GlobalStateKey<uint64>({ key: StateKeys.PEG_RATIO });

  tokenId = GlobalStateKey<AssetID>({ key: StateKeys.TOKEN_ID });

  vestId = GlobalStateKey<AssetID>({ key: StateKeys.VEST_ID });

  stVestId = GlobalStateKey<AssetID>({ key: StateKeys.STAKED_VEST_ID });

  tokenCirculatingSupply = GlobalStateKey<uint64>({
    key: 'token_circulating_supply',
  });

  highestBidder = GlobalStateKey<AppID>({ key: StateKeys.HIGHEST_BIDDER });

  burnQueue = GlobalStateKey<StaticArray<AppID, 5>>({ key: StateKeys.BURN_QUEUE });

  lastExhaustBlock = GlobalStateKey<uint64>({ key: StateKeys.LAST_EXHAUST_BLOCK });

  lastFlashloanBlock = GlobalStateKey<uint64>({ key: StateKeys.LAST_FLASHLOAN_BLOCK });

  flashLoanCounter = GlobalStateKey<uint64>({ key: StateKeys.FLASHLOAN_COUNTER });

  @allow.bareCreate('NoOp')
  createApplication(): void {
    this.manager.value = this.app.creator;
    this.validatorPoolContractVersion.value = 0;
    this.validatorPoolContractCost.value = Values.VALIDATOR_POOL_CONTRACT_MBR;

    this.totalStake.value = 0;
    this.pegRatio.value = 1 * Values.SCALE;

    this.tokenId.value = AssetID.zeroIndex;
    this.tokenCirculatingSupply.value = 0;

    this.highestBidder.value = AppID.zeroIndex;

    this.burnQueue.value = [];

    this.lastExhaustBlock.value = 0;
  }

  updateApplication(): void {
    assert(this.txn.sender === this.manager.value);
  }

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

  MANAGER_updateVestTokensID(vestID: AssetID, stVestID: AssetID): void {
    assert(this.txn.sender === this.manager.value, 'only the manager can call this method');
    this.vestId.value = vestID;
    this.stVestId.value = stVestID;
  }

  MANAGER_changeManager(manager: Address): void {
    assert(this.txn.sender === this.manager.value, 'only the manager can call this method');
    this.manager.value = manager;
  }

  MANAGER_updatePoolContractCost(validatorPoolContractCost: uint64): void {
    assert(this.txn.sender === this.manager.value, 'only the manager can call this method');
    this.validatorPoolContractCost.value = validatorPoolContractCost;
  }

  MANAGER_updatePoolContractProgram(programSize: uint64): void {
    assert(this.txn.sender === this.manager.value, 'only the manager can call this method');

    if (this.validatorPoolContractApprovalProgram.exists) {
      this.validatorPoolContractApprovalProgram.resize(programSize);
    } else {
      this.validatorPoolContractApprovalProgram.create(programSize);
    }

    this.validatorPoolContractVersion.value += 1;
  }

  MANAGER_writePoolContractProgram(offset: uint64, data: bytes): void {
    assert(this.txn.sender === this.manager.value, 'only the manager can call this method');

    this.validatorPoolContractApprovalProgram.replace(offset, data);
  }

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

  burnRequest(burnTxn: AssetTransferTxn, burnTo: Address): void {
    verifyAssetTransferTxn(burnTxn, {
      xferAsset: this.tokenId.value,
      assetReceiver: this.app.address,
      assetAmount: { greaterThanEqualTo: Values.ALGORAND_BASE_FEE },
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
      return;
    }

    if (this.queueIsEmpty()) {
      return;
    }

    assert(
      globals.round - this.lastExhaustBlock.value > Values.BURN_COOLDOWN,
      'wait at least 5 blocks since Exhaust Block'
    );

    for (let i = 0; i < this.burnQueue.value.length; i += 1) {
      const currentTargetInQueue = this.burnQueue.value[i];
      if (this.isPool(currentTargetInQueue)) {
        const delegatedToTarget = currentTargetInQueue.globalState(StateKeys.DELEGATED_STAKE) as uint64;
        if (delegatedToTarget < amountToBurn - burning) {
          this.doBurnTxn(currentTargetInQueue, [delegatedToTarget, burnTo]);
          this.burnQueue.value[i] = AppID.zeroIndex;
          burning += delegatedToTarget;
        } else {
          this.doBurnTxn(currentTargetInQueue, [amountToBurn - burning, burnTo]);
          burning = amountToBurn;
          break;
        }
      }
    }

    const amountLeft = this.getBurnAmount(amountToBurn - burning);
    if (amountLeft > 0) {
      this.doAxfer(burnTxn.sender, amountLeft, this.tokenId.value);
      this.lastExhaustBlock.value = globals.round;
    }
    this.tokenCirculatingSupply.value -= burnTxn.assetAmount - amountLeft;
    this.totalStake.value -= burning;

    this.burnEvent.log({
      filled: amountLeft > 0,
      amount: burnTxn.assetAmount - amountLeft,
      output: burning,
    });
    // totalStake --
    // vALGO circ supply --
    // take burn queue
    // iterate and subtract from the request the amount you can take, stop when order is filled
    // if the order is not filled send back the remaining amount of vALGO
  }

  mintValidatorCommit(validatorAppID: AppID, stakeCommit: PayTxn): void {
    assert(this.isPool(validatorAppID));
    const operatorAddress = validatorAppID.globalState(StateKeys.OPERATOR_ADDRESS) as Address;
    verifyPayTxn(stakeCommit, {
      sender: operatorAddress,
      receiver: this.app.address,
    });

    sendMethodCall<typeof CaelusValidatorPool.prototype.addToOperatorCommit>({
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
    this.totalStake.value += stakeCommit.amount;
    this.tokenCirculatingSupply.value += amountToMint;
  }

  // burn & send to operator; amount is the LST amount of commit to burn
  // this burn method for the operator directly burns vAlgo taking Algo from the validator contract of the operator, reducing his commit
  burnValidatorCommit(appToBurnFrom: AppID, amount: uint64): void {
    this.isPool(appToBurnFrom);
    verifyTxn(this.txn, {
      sender: appToBurnFrom.globalState(StateKeys.OPERATOR_ADDRESS) as Address,
    });
    const toBurn = this.getBurnAmount(amount);
    sendMethodCall<typeof CaelusValidatorPool.prototype.removeFromOperatorCommit, void>({
      applicationID: appToBurnFrom,
      methodArgs: [toBurn, amount],
    });
    this.totalStake.value -= toBurn;
    this.tokenCirculatingSupply.value -= amount;
  }

  // when operator is delinquent set up burn of his LST amount in the App Account
  // burn & send to validator app
  burnToDelinquentValidator(burnTxn: AssetTransferTxn, validatorAppID: AppID): void {
    // get AssetTransferTxn as burn type
    // check that app is delinquent
    // check that app is pool
    // init burn request for the amount sent
    // reduce tot circ supply of vALGO
    this.isPool(validatorAppID);
    assert(globals.round - this.lastExhaustBlock.value > Values.BURN_COOLDOWN, "can only burn if we're not exhausted");
    verifyAssetTransferTxn(burnTxn, {
      xferAsset: this.tokenId.value,
      assetSender: validatorAppID.address,
    });
    assert((validatorAppID.globalState(StateKeys.STATUS) as uint64) !== 2);
    let amountToUpdate: uint64 = 0; // the ASA amount to give back if the burn request isnt filled && then reduce circ supply
    let toBurn: uint64 =
      this.getBurnAmount(burnTxn.assetAmount) - (validatorAppID.globalState(StateKeys.OPERATOR_COMMIT) as uint64); // burn from other validators the amount of Algo accrued from the operator LST
    let amtBurned = 0; // need this to subtract from totalAlgoSupply
    for (let i = 0; i < this.burnQueue.value.length; i += 1) {
      const currentTargetInQueue = this.burnQueue.value[i];
      if (this.isPool(currentTargetInQueue)) {
        const delegatedToTarget = currentTargetInQueue.globalState(StateKeys.DELEGATED_STAKE) as uint64;
        if (delegatedToTarget >= toBurn) {
          this.doBurnTxn(currentTargetInQueue, [toBurn, this.app.address]);
          amtBurned += toBurn;
          toBurn = 0;
          break;
        } else {
          this.doBurnTxn(currentTargetInQueue, [delegatedToTarget, this.app.address]);
          amtBurned += delegatedToTarget;
          toBurn -= delegatedToTarget;
        }
      }
    }
    amountToUpdate = this.getBurnAmount(toBurn - amtBurned);
    this.tokenCirculatingSupply.value -= burnTxn.assetAmount - amountToUpdate;
    this.totalStake.value -= amtBurned;
    if (amountToUpdate > 0) {
      this.doAxfer(burnTxn.sender, amountToUpdate, this.tokenId.value);
    }
    sendMethodCall<typeof CaelusValidatorPool.prototype.addToOperatorCommit>({
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

  // when operator clears delinquency remint the LST burned
  reMintDelinquentCommit(app: AppID): void {
    // get amount and check with operator commit
    // check that app is not delinquent anymore & his vAlgo amount is 0
    // send vAlgo amount corresponding to the current peg for the operatorCommit amount
    this.isPool(app);
    assert((app.globalState(StateKeys.STATUS) as uint64) !== 2, 'must solve delinquency first');
    const amount = app.globalState(StateKeys.OPERATOR_COMMIT) as uint64;
    assert(
      app.address.assetBalance(this.tokenId.value) === 0,
      'If the app already has vALGO it cannot mint with this method'
    );
    const amountToMint = this.getMintAmount(amount);
    this.doAxfer(app.address, amountToMint, this.tokenId.value);
    this.tokenCirculatingSupply.value += amountToMint;

    this.mintEvent.log({
      instant: true,
      amount: amount,
      output: amountToMint,
    });
  }

  // called to bid new validator as highest bidder
  // No assert call to avoid future P2P spam.
  bid(validatorAppID: AppID): void {
    assert(this.isPool(validatorAppID));
    const isDelegatable = (validatorAppID.globalState(StateKeys.STATUS) as uint64) === 0;
    if (!this.isPool(this.highestBidder.value)) {
      this.highestBidder.value = validatorAppID;
      return;
    }
    const challengerBuffer = validatorAppID.globalState(StateKeys.SATURATION_BUFFER) as uint64;
    const highestBuffer = this.highestBidder.value.globalState(StateKeys.SATURATION_BUFFER) as uint64;
    assert(isDelegatable, 'only bid delegatable Apps');
    if (challengerBuffer > highestBuffer) {
      this.highestBidder.value = validatorAppID;
    }

    this.bidEvent.log({
      app: validatorAppID,
      isHeighest: this.highestBidder.value === validatorAppID,
    });
  }

  // called to send the Algo used to mint vALGO to the highest bidder
  delegateStake(amount: uint64, validatorAppID: AppID): void {
    assert(this.isPool(validatorAppID));
    assert(validatorAppID === this.highestBidder.value, 'can only delegate to highest bidder account');
    sendMethodCall<typeof CaelusValidatorPool.prototype.addStake, void>({
      applicationID: validatorAppID,
      methodArgs: [
        {
          receiver: validatorAppID.address,
          amount: amount,
        },
      ],
    });
  }

  // used to set new validator inside the burn queue || burn Prio
  snitchToBurn(app: AppID): void {
    assert(this.isPool(app));
    const satSnitch = app.globalState(StateKeys.SATURATION_BUFFER) as uint64;
    let minPrio = app;
    let minSat = satSnitch;

    const queue = this.burnQueue.value;
    for (let i = 0; i < queue.length; i += 1) {
      if (!this.isPool(queue[i])) {
        queue[i] = minPrio;
        break;
      }
      if ((queue[i].globalState(StateKeys.SATURATION_BUFFER) as uint64) < minSat) {
        const temp = minPrio;
        minPrio = queue[i];
        minSat = queue[i].globalState(StateKeys.SATURATION_BUFFER) as uint64;
        queue[i] = temp;
      }
    }

    this.snitchQueueEvent.log({
      queue: this.burnQueue.value,
    });
    // for loop on the queue of addresses checking saturation vs minPrio
    // iterate and check values
    // if higher -> replace
  }

  multiSnitchToBurn(apps: AppID[]): void {
    for (let i = 0; i < apps.length; i += 1) {
      const appToSnitch = apps[i];
      this.snitchToBurn(appToSnitch);
    }
  }

  /**
   * Used to check the behavior of a Validator App
   *
   * @param {AppID} appToCheck - Validator AppID to snitch
   * @param {SnitchInfo} params - SnitchInfo object containing the informations to check
   * @returns {boolean} result of the snitch if successfull -> true
   */
  snitchCheck(appToCheck: AppID, params: SnitchInfo): boolean {
    assert(this.isPool(appToCheck));
    assert(this.isPool(params.recipient) || params.recipient.address === this.app.address);

    const result = sendMethodCall<typeof CaelusValidatorPool.prototype.getSnitched, boolean>({
      applicationID: appToCheck,
      methodArgs: [params],
    });

    this.snitchValidatorEvent.log({
      request: params,
      result: result,
    });

    return result;
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
      sendMethodCall<typeof CaelusValidatorPool.prototype.getClawbackedStake, void>({
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
   * Used to close and delete a validator pool contract, only callable by the node operator.
   *
   * @param {AppID} appToClose  - The AppID of the operator to close
   */
  onOperatorExit(appToClose: AppID): void {
    verifyTxn(this.txn, {
      sender: appToClose.globalState(StateKeys.OPERATOR_ADDRESS) as Address,
    });

    sendMethodCall<typeof CaelusValidatorPool.prototype.deleteApplication, void>({
      applicationID: appToClose,
      methodArgs: [],
    });
  }

  // TODO : DOCUMENT ON THE EVENTUAL SDK HOW THE FEE STRUCTURE WORKS TO AVOID SOMEONE YEETING THEIR NETWORTH ON A FLASH LOAN FEE
  makeFlashLoanRequest(payFeeTxn: PayTxn, amounts: uint64[], appToInclude: AppID[]): void {
    this.getFLcounter();
    this.flashLoanCounter.value += appToInclude.length;
    const keepFee = this.flashLoanCounter.value + Values.FLASH_LOAN_FEE;

    verifyPayTxn(payFeeTxn, {
      receiver: this.app.address,
      amount: keepFee,
    });

    assert(amounts.length === appToInclude.length, 'array length [amount, appToInclude] mismatch');
    for (let i = 0; i < appToInclude.length; i += 1) {
      this.pendingGroup.addMethodCall<typeof CaelusValidatorPool.prototype.flashloan, void>({
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
        assert(repaid);
      }
    }
    this.pendingGroup.submit();
    this.flashLoanEvent.log({ apps: appToInclude, amounts: amounts });
  }

  @abi.readonly
  getFLcounter(): uint64 {
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

  private calculateLSTRatio(): void {
    if (this.tokenCirculatingSupply.value === 0) {
      return;
    }
    this.pegRatio.value = wideRatio([this.totalStake.value, Values.SCALE], [this.tokenCirculatingSupply.value]);
  }

  private getMintAmount(amount: uint64): uint64 {
    this.calculateLSTRatio();
    return wideRatio([amount, Values.SCALE], [this.pegRatio.value]);
  }

  private getBurnAmount(amount: uint64): uint64 {
    this.calculateLSTRatio();
    return wideRatio([amount, this.pegRatio.value], [Values.SCALE]);
  }

  private doBurnTxn(target: AppID, args: [uint64, Address]): void {
    sendMethodCall<typeof CaelusValidatorPool.prototype.burnStake, void>({
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
    for (let i = 0; i < this.burnQueue.value.length; i += 1) {
      if (this.burnQueue.value[i] !== AppID.zeroIndex) {
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

  snitchValidatorEvent = new EventLogger<{
    request: SnitchInfo;
    result: boolean;
  }>();

  flashLoanEvent = new EventLogger<{
    apps: AppID[];
    amounts: uint64[];
  }>();
}
