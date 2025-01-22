/* eslint-disable import/no-cycle */
import { Contract } from '@algorandfoundation/tealscript';
import { CaelusValidatorPool } from './CaelusValidator.algo';
import {
  ALGORAND_BASE_FEE,
  BURN_COOLDOWN,
  CLAIM_DELAY,
  MintClaim,
  MINTCLAIM_ORDER_BOX_MBR,
  PROTOCOL_COMMISSION,
  SCALE,
  SnitchInfo,
  VALIDATOR_POOL_CONTRACT_MBR,
  FLASH_LOAN_FEE,
} from './constants.algo';

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

  totalStake = GlobalStateKey<uint64>({ key: 'total_stake' });

  idleStake = GlobalStateKey<uint64>({ key: 'idle_stake' }); // Algo deposited on Mint Request and yet to be distributed to the highest bidder

  pegRatio = GlobalStateKey<uint64>({ key: 'peg_ratio' });

  tokenId = GlobalStateKey<AssetID>({ key: 'token_id' });

  tokenCirculatingSupply = GlobalStateKey<uint64>({
    key: 'token_circulating_supply',
  });

  highestBidder = GlobalStateKey<AppID>({ key: 'highest_bidder' });

  burnQueue = GlobalStateKey<StaticArray<AppID, 10>>({ key: 'burn_queue' });

  burnTarget = GlobalStateKey<AppID>({ key: 'burn_target' });

  lastExhaustBlock = GlobalStateKey<uint64>({ key: 'last_exhaust_block' });

  lastFlashloanBlock = GlobalStateKey<uint64>({ key: 'last_flashloan_block' });

  flashLoanCounter = GlobalStateKey<uint64>({ key: 'flashloan_counter' });

  mintOrders = BoxMap<Address, MintClaim>({ allowPotentialCollisions: true });

  @allow.bareCreate('NoOp')
  createApplication(): void {
    this.manager.value = this.app.creator;
    this.validatorPoolContractVersion.value = 0;
    this.validatorPoolContractCost.value = VALIDATOR_POOL_CONTRACT_MBR;

    this.totalStake.value = 0;
    this.idleStake.value = 0;
    this.pegRatio.value = 1 * SCALE;

    this.tokenId.value = AssetID.zeroIndex;
    this.tokenCirculatingSupply.value = 0;

    this.highestBidder.value = AppID.zeroIndex;

    this.burnQueue.value = [];
    this.burnTarget.value = AppID.zeroIndex;

    this.lastExhaustBlock.value = 0;
  }

  MANAGER_config(manager: Address, validatorPoolContractCost: uint64): void {
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

    this.manager.value = manager;
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
      approvalProgram: [
        // will this work for contract size < 4096?
        this.validatorPoolContractApprovalProgram.extract(0, 4096),
        this.validatorPoolContractApprovalProgram.extract(4096, this.validatorPoolContractApprovalProgram.size - 4096),
      ],
      clearStateProgram: CaelusValidatorPool.clearProgram(),
      globalNumUint: CaelusValidatorPool.schema.global.numUint,
      globalNumByteSlice: CaelusValidatorPool.schema.global.numByteSlice,
      extraProgramPages: 3,
      applicationArgs: [
        method('createApplication(uint64,bytes,uint64,uint64,uint64,uint64)void'),
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

  delayedMintRequest(mintTxn: PayTxn, coverMBR: PayTxn): void {
    verifyPayTxn(mintTxn, {
      receiver: this.app.address,
      amount: { greaterThanEqualTo: globals.minTxnFee },
    });
    verifyPayTxn(coverMBR, {
      receiver: this.app.address,
      amount: { greaterThanEqualTo: MINTCLAIM_ORDER_BOX_MBR },
    });
    assert(!this.mintOrders(mintTxn.sender).exists, 'can only create one mint order at the time');

    this.idleStake.value += mintTxn.amount;
    this.totalStake.value += mintTxn.amount;

    const minted = this.getMintAmount(mintTxn.amount);

    const mintOrder: MintClaim = {
      amount: minted,
      block: globals.round,
    };

    this.mintOrders(mintTxn.sender).value = mintOrder;

    this.mintEvent.log({
      instant: false,
      amount: mintTxn.amount,
      output: minted,
    });
  }

  claimMint(): void {
    assert(this.mintOrders(this.txn.sender).exists, 'no mint order to claim');
    assert(
      this.mintOrders(this.txn.sender).value.block < globals.round - CLAIM_DELAY,
      'must wait 330 blocks after initial mint to claim the token'
    );

    const minted = this.mintOrders(this.txn.sender).value.amount;

    this.mintOrders(this.txn.sender).delete();

    this.doAxfer(this.txn.sender, minted, this.tokenId.value);

    sendPayment({
      receiver: this.txn.sender,
      amount: MINTCLAIM_ORDER_BOX_MBR,
    });

    this.tokenCirculatingSupply.value += minted;
  }

  getPremiumAmount(amount: uint64): uint64 {
    while (globals.opcodeBudget <= 4600) {
      increaseOpcodeBudget();
    }

    let accumulatedRewards = 0;

    for (let lookupRound = globals.round - 2 - 320; lookupRound < globals.round - 2; lookupRound += 1) {
      accumulatedRewards += blocks[lookupRound].proposerPayout;
      lookupRound += 1;
    }

    return wideRatio([amount, accumulatedRewards], [onlineStake()]);
  }

  instantMintRequest(mintTxn: PayTxn): void {
    verifyPayTxn(mintTxn, {
      receiver: this.app.address,
      amount: { greaterThanEqualTo: globals.minTxnFee },
    });

    const premium = this.getPremiumAmount(mintTxn.amount) < 1000 ? 1000 : this.getPremiumAmount(mintTxn.amount);
    const premiumToByte = rawBytes(premium);
    log('premium is: ' + premiumToByte);
    const minted = this.getMintAmount(mintTxn.amount - premium);
    this.doAxfer(this.txn.sender, minted, this.tokenId.value);
    this.tokenCirculatingSupply.value += minted;
    this.idleStake.value += mintTxn.amount;
    this.totalStake.value += mintTxn.amount;

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
      assetAmount: { greaterThanEqualTo: ALGORAND_BASE_FEE },
    });

    const amountToBurn = this.getBurnAmount(burnTxn.assetAmount);
    let burning = 0;

    if (this.idleStake.value > 0) {
      const amountToBurnFromIdle = this.idleStake.value >= amountToBurn ? amountToBurn : this.idleStake.value;
      this.idleStake.value -= amountToBurnFromIdle;
      this.totalStake.value -= amountToBurnFromIdle;
      burning += amountToBurnFromIdle;

      sendPayment({
        receiver: burnTxn.sender,
        amount: amountToBurnFromIdle,
      });
    }

    // After exhaust flag there needs to be at least 1 block cooldown, if the queue is full, otherwise 10 rounds
    if (
      this.burnTarget.value === AppID.zeroIndex &&
      !this.queueIsFull() &&
      globals.round - this.lastExhaustBlock.value > 1
    ) {
      assert(
        globals.round - this.lastExhaustBlock.value > BURN_COOLDOWN,
        'wait at least 10 blocks since Exhaust Block'
      );
    }

    if (this.isPool(this.burnTarget.value)) {
      const delegatedToTarget = this.burnTarget.value.globalState('delegated_stake') as uint64;
      if (delegatedToTarget >= amountToBurn) {
        this.doBurnTxn(this.burnTarget.value, [amountToBurn, burnTo]);
        const value = this.burnQueue.value[0];
        this.burnTarget.value = AppID.zeroIndex;
        if (this.isPool(value)) {
          this.snitchToBurn(value);
        }
        return;
      }
      burning = this.burnTarget.value.globalState('delegated_stake') as uint64;
      this.doBurnTxn(this.burnTarget.value, [delegatedToTarget, burnTo]);
    }
    for (let i = 0; i < this.burnQueue.value.length; i += 1) {
      const currentTargetInQueue = this.burnQueue.value[i];
      if (this.isPool(currentTargetInQueue)) {
        const delegatedToTarget = currentTargetInQueue.globalState('delegated_stake') as uint64;
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
      this.doAxfer(
        burnTxn.sender, // the sender needs to be the burnTxn sender, so when operator burns vALGO from the app it returns the amount left to burn
        amountLeft,
        this.tokenId.value
      );
      this.tokenCirculatingSupply.value -= burnTxn.assetAmount - amountLeft;
      this.totalStake.value -= burning;
      this.lastExhaustBlock.value = globals.round;

      this.burnEvent.log({
        filled: amountLeft > 0,
        amount: burnTxn.assetAmount - amountLeft,
        output: burning,
      });
      return;
    }
    this.totalStake.value -= burning;
    this.tokenCirculatingSupply.value -= burnTxn.assetAmount;

    this.burnEvent.log({
      filled: amountLeft > 0,
      amount: burnTxn.assetAmount,
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
    const operatorAddress = validatorAppID.globalState('operator_address') as Address;
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
  burnValidatorCommit(appToBurnFrom: AppID, burnTxn: AssetTransferTxn): void {
    // just like a burn but take from the operator app
    // reduce tot circ supply of vALGO
    // reduce tot Algo staked
    this.isPool(appToBurnFrom);
    // the txn has to be issued by the Validator App Account with the proper method
    verifyTxn(this.txn, {
      sender: appToBurnFrom.address,
    });
    verifyAssetTransferTxn(burnTxn, {
      xferAsset: this.tokenId.value,
      assetReceiver: this.app.address,
    });
    const opCmt = appToBurnFrom.globalState('operator_commit') as uint64;
    assert(!(appToBurnFrom.globalState('is_delinquent') as boolean), 'con only burn when delinquency is solved');
    const toBurn = this.getBurnAmount(burnTxn.assetAmount);
    assert(opCmt < toBurn && opCmt - toBurn > globals.payoutsMinBalance, 'cannot burn more than the committed amount');
    sendMethodCall<typeof CaelusValidatorPool.prototype.removeFromOperatorCommit, void>({
      applicationID: appToBurnFrom,
      methodArgs: [toBurn],
    });
    this.totalStake.value -= toBurn;
    this.tokenCirculatingSupply.value -= burnTxn.assetAmount;
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
    assert(globals.round - this.lastExhaustBlock.value > BURN_COOLDOWN, "can only burn if we're not exhausted");
    verifyAssetTransferTxn(burnTxn, {
      xferAsset: this.tokenId.value,
      assetSender: validatorAppID.address,
    });
    assert(validatorAppID.globalState('is_delinquent') as boolean);
    let amountToUpdate = 0; // the ASA amount to give back if the burn request isnt filled && then reduce circ supply
    let toBurn = this.getBurnAmount(burnTxn.assetAmount) - (validatorAppID.globalState('operator_commit') as uint64); // burn from other validators the amount of Algo accrued from the operator LST
    let amtBurned = 0; // need this to subtract from totalAlgoSupply
    if (this.isPool(this.burnTarget.value)) {
      const prioStake = this.burnTarget.value.globalState('delegated_stake') as uint64;
      amtBurned = prioStake >= toBurn ? prioStake : toBurn - prioStake;
      this.doBurnTxn(this.burnTarget.value, [amtBurned, this.app.address]);
      toBurn -= amtBurned;
    }
    if (toBurn > 0) {
      for (let i = 0; i < this.burnQueue.value.length; i += 1) {
        const currentTargetInQueue = this.burnQueue.value[i];
        if (this.isPool(currentTargetInQueue)) {
          const delegatedToTarget = currentTargetInQueue.globalState('delinquent_stake') as uint64;
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
    assert(!(app.globalState('is_delinquent') as boolean), 'must solve delinquency first');
    const amount = app.globalState('operator_commit') as uint64;
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
    const isDelegatable = validatorAppID.globalState('can_be_delegated') as boolean;
    if (this.isPool(this.highestBidder.value)) {
      this.highestBidder.value = validatorAppID;
      return;
    }
    const challengerBuffer = validatorAppID.globalState('saturation_buffer') as uint64;
    const highestBuffer = this.highestBidder.value.globalState('saturation_buffer') as uint64;
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
    assert(amount <= this.idleStake.value, 'cant withdraw more than the amount of idleAlgo in the contract');
    sendMethodCall<typeof CaelusValidatorPool.prototype.addStake, void>({
      applicationID: validatorAppID,
      methodArgs: [
        {
          receiver: validatorAppID.address,
          amount: amount,
        },
      ],
    });
    this.idleStake.value -= amount;
  }

  // used to set new validator inside the burn queue || burn Prio
  snitchToBurn(app: AppID): void {
    assert(this.isPool(app));
    const satSnitch = app.globalState('saturation_buffer') as uint64;
    let minPrio = app;
    let minSat = satSnitch;
    if (this.isPool(this.burnTarget.value)) {
      const satPrio = this.burnTarget.value.globalState('saturation_buffer') as uint64;
      if (satSnitch > satPrio) {
        minPrio = this.burnTarget.value;
        minSat = satPrio;
        this.burnTarget.value = app;
      }
    }
    const queue = this.burnQueue.value;
    for (let i = 0; i < queue.length; i += 1) {
      if (!this.isPool(queue[i])) {
        queue[i] = minPrio;
        break;
      }
      if ((queue[i].globalState('saturation_buffer') as uint64) < minSat) {
        const temp = minPrio;
        minPrio = queue[i];
        queue[i] = temp;
      }
    }

    this.snitchQueueEvent.log({
      prio: this.burnTarget.value,
      queue: this.burnQueue.value,
    });
    // for loop on the queue of addresses checking saturation vs minPrio
    // iterate and check values
    // if higher -> replace
  }

  multiSnitchToBurn(apps: AppID[]): void {
    for (let i = 0; i < apps.length; i += 1) {
      const currentTargetInQueue = apps[i];
      assert(this.isPool(currentTargetInQueue));
      this.snitchToBurn(currentTargetInQueue);
    }
  }

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

  // used to route txn both to restake into the auction or to another validator, depending on the receiver
  reStakeFromSnitch(snitchedApp: AppID, receiverApp: AppID, restakeTxn: PayTxn): void {
    assert(this.isPool(snitchedApp)); // or is this.App can't do it cause Spanish keyboard ñ
    assert(receiverApp.address === restakeTxn.receiver);
    if (restakeTxn.receiver !== this.app.address) {
      sendMethodCall<typeof CaelusValidatorPool.prototype.getClawbackedStake, void>({
        applicationID: receiverApp,
        methodArgs: [
          {
            receiver: restakeTxn.receiver,
            amount: restakeTxn.amount,
          },
        ],
      });
      return;
    }
    verifyPayTxn(restakeTxn, {
      sender: snitchedApp.address,
      receiver: this.app.address,
    });
    this.idleStake.value += restakeTxn.amount;
  }

  declareRewards(txn: PayTxn, ifValidator: AppID): void {
    verifyPayTxn(txn, {
      receiver: this.app.address,
    });
    let restakeRewards = txn.amount;
    assert(
      (this.isPool(ifValidator) && ifValidator.address === this.txn.sender) || ifValidator === AppID.zeroIndex,
      'either the caller is a Caelus Pool App or set the second param to 0 '
    );
    const protocolCut = wideRatio([PROTOCOL_COMMISSION, txn.amount], [100]);
    if (this.isPool(ifValidator)) {
      restakeRewards -= protocolCut;
      sendPayment({
        receiver: this.manager.value,
        amount: protocolCut,
      });
    }

    this.idleStake.value += restakeRewards;
    this.totalStake.value += restakeRewards;
  }

  // operator calls for its own app; clawback all delegated stake and ensure that the operator receives the ASA, he will proceed to burn
  onOperatorExit(appToClose: AppID, closeTxn: PayTxn): void {
    verifyTxn(this.txn, {
      sender: appToClose.address,
      receiver: this.app.address,
    });
    this.idleStake.value += closeTxn.amount;
    sendMethodCall<typeof CaelusValidatorPool.prototype.deleteApplication, void>({
      applicationID: appToClose,
      methodArgs: [],
    });
  }

  // TODO : DOCUMENT ON THE EVENTUAL SDK HOW THE FEE STRUCTURE WORKS TO AVOID SOMEONE YEETING THEIR NETWORTH ON A FLASH LOAN FEE
  makeFlashLoanRequest(payFeeTxn: PayTxn, amounts: uint64[], appToInclude: AppID[]): void {
    this.getFLcounter();
    this.flashLoanCounter.value += appToInclude.length;
    const keepFee = this.flashLoanCounter.value + FLASH_LOAN_FEE;

    verifyPayTxn(payFeeTxn, {
      receiver: this.app.address,
      amount: keepFee,
    });

    this.idleStake.value += keepFee;

    assert(amounts.length === appToInclude.length, 'array length [amount, appToInclude] mismatch');
    // Ask Joe if this.pendingGroup creates a new txn group or appends it as an inner.
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

  //-------------------------------------------------------------------------------------------------------------------

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

  private queueIsFull(): boolean {
    const prioIsSet = this.isPool(this.burnTarget.value);
    let queueIsFull = true;
    for (let i = 0; i < this.burnQueue.value.length; i += 1) {
      queueIsFull = this.isPool(this.burnQueue.value[i]);
      if (!queueIsFull) {
        break;
      }
    }
    return prioIsSet && queueIsFull;
  }

  // private minBalanceForAccount(
  //   contracts: uint64,
  //   extraPages: uint64,
  //   assets: uint64,
  //   localInts: uint64,
  //   localBytes: uint64,
  //   globalInts: uint64,
  //   globalBytes: uint64,
  // ): uint64 {
  //   let minBal = ALGORAND_ACCOUNT_MIN_BALANCE;
  //   minBal += contracts * APPLICATION_BASE_FEE;
  //   minBal += extraPages * APPLICATION_BASE_FEE;
  //   minBal += assets * ASSET_HOLDING_FEE;
  //   minBal += localInts * SSC_VALUE_UINT;
  //   minBal += globalInts * SSC_VALUE_UINT;
  //   minBal += localBytes * SSC_VALUE_BYTES;
  //   minBal += globalBytes * SSC_VALUE_BYTES;
  //   return minBal;
  // }

  //-----------------------------------------------------------------------------------------------------------------

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
    prio: AppID;
    queue: StaticArray<AppID, 10>;
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
