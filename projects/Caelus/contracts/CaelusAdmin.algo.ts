/* eslint-disable import/no-cycle */
import { Contract } from '@algorandfoundation/tealscript';
import { CaelusValidatorPool } from './CaelusValidator.algo';
import {
  ALGORAND_ACCOUNT_MIN_BALANCE,
  ALGORAND_BASE_FEE,
  APPLICATION_BASE_FEE,
  ASSET_HOLDING_FEE,
  FLASH_LOAN_FEE,
  PROTOCOL_COMMISSION,
  SCALE,
  SnitchInfo,
  SSC_VALUE_BYTES,
  SSC_VALUE_UINT,
} from './constants.algo';

/**
 * CaelusAdmin is the main contract handling the Caelus protocol.
 * Core Features:
 * - handling minting and burning of vALGO
 * - keep the peg ratio vALGO:ALGO
 * - auction for distribution on mint and clawback on burn
 * - force redistribution of stake
 * - deploy Validator Pool Contracts
 */
export class CaelusAdmin extends Contract {
  programVersion = 11;

  pegRatio = GlobalStateKey<uint64>({ key: 'peg' });

  epochLen = GlobalStateKey<uint64>({ key: 'epochlen' }); // use to recalculate pegRatio?

  initializedPoolContract = GlobalStateKey<boolean>({ key: 'initPoolContract' }); // is box instantiated for Validator Approval Program?

  validatorPoolContractVersion = GlobalStateKey<uint64>({ key: 'validatorPoolVersion' }); // manager should be able to update this value

  totalAlgoStaked = GlobalStateKey<uint64>({ key: 'totalstake' });

  validatorPoolContractApprovalProgram = BoxKey<bytes>({ key: 'validatorApprovalProgram' });

  init_vALGO = GlobalStateKey<boolean>({ key: 'init_vALGO' });

  vALGOid = GlobalStateKey<AssetID>({ key: 'vALGOid' });

  vestID = GlobalStateKey<AssetID>({ key: 'vestID' });

  stVestID = GlobalStateKey<AssetID>({ key: 'stVestID' });

  circulatingSupply = GlobalStateKey<uint64>({ key: 'circulatingSupply' });

  highestBidder = GlobalStateKey<AppID>({ key: 'highestBidder' });

  idleAlgoToStake = GlobalStateKey<uint64>({ key: 'idleAlgo' });

  vestigeAddress = GlobalStateKey<Address>({ key: 'vestigeAddress' });

  // flashloan related Keys

  flashLoanCounter = GlobalStateKey<uint64>({ key: 'flashLoanCounter' });

  lastFlashloanBlock = GlobalStateKey<uint64>({ key: 'lastFlashloanBlock' });

  burnQueue = BoxKey<StaticArray<AppID, 10>>({
    key: 'burnQueue',
    dynamicSize: false,
  });

  burnPrio = GlobalStateKey<AppID>({ key: 'burnPrio' });

  // ----------------------------------------------------------------------------------------------------
  createApplication(): void {
    this.totalAlgoStaked.value = 0;
    this.init_vALGO.value = false;
    this.initializedPoolContract.value = false;
    this.validatorPoolContractVersion.value = 0;
    this.pegRatio.value = 1 * SCALE;
    // TODO FINISH UP CREATE APPLICATION METHOD
  }

  initPoolContract(programSize: uint64): void {
    assert(this.txn.sender === this.app.creator);
    this.validatorPoolContractApprovalProgram.create(programSize);
  }

  loadPoolContractProgram(offsett: uint64, data: bytes): void {
    assert(!this.initializedPoolContract.value); // add new approval contract updated version
    this.validatorPoolContractApprovalProgram.replace(offsett, data);
  }

  poolContractIsSet(): void {
    assert(this.txn.sender === this.app.creator);
    this.initializedPoolContract.value = true;
    this.validatorPoolContractVersion.value += 1;
  }

  initLST(name: string, unitName: string, url: string): void {
    assert(this.txn.sender === this.app.creator);
    assert(!this.init_vALGO.value);
    this.vALGOid.value = sendAssetCreation({
      configAssetTotal: 10_000_000,
      configAssetDecimals: 6,
      configAssetReserve: this.app.address,
      configAssetManager: globals.zeroAddress,
      configAssetClawback: globals.zeroAddress,
      configAssetFreeze: globals.zeroAddress,
      configAssetDefaultFrozen: 0,
      configAssetName: name,
      configAssetUnitName: unitName,
      configAssetURL: url,
    });
    this.init_vALGO.value = true;
  }

  initBurnQueue(): void {
    assert(this.txn.sender === this.app.creator);
    const fixedQueueLength = 8 * 10; // 8 bytes for AppID * 10 : max length of the burnQueue
    this.burnQueue.create(fixedQueueLength);
  }

  addCaelusValidator(mbrPay: PayTxn): void {
    const mbr = this.minBalanceForAccount(
      1,
      3,
      1,
      0,
      0,
      CaelusValidatorPool.schema.global.numUint,
      CaelusValidatorPool.schema.global.numByteSlice
    );
    verifyPayTxn(mbrPay, {
      receiver: this.app.address,
      amount: mbr,
    });

    sendAppCall({
      onCompletion: OnCompletion.NoOp,
      approvalProgram: [
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
        itob(this.vestID.value),
        itob(this.stVestID.value),
        itob(this.vALGOid.value),
      ],
    }); // TODO IS THIS ALL?
  }

  // to calculate use totalAlgoStaked/LSTcirculatingSupply
  // this can just be a private method or abi.readonly to be called by Mint and Burn methods
  @abi.readonly
  calculateLSTRatio(): void {
    // SCALE value is...?
    this.pegRatio.value = wideRatio([this.totalAlgoStaked.value, SCALE], [this.circulatingSupply.value]);
  }

  getMintAmount(amount: uint64): uint64 {
    this.calculateLSTRatio();
    return wideRatio([amount, SCALE], [this.pegRatio.value]); // TODO check math, SCALE?
  }

  getBurnAmount(amount: uint64): uint64 {
    this.calculateLSTRatio();
    return wideRatio([amount, this.pegRatio.value], [SCALE]);
  }

  // user mint vALGO, sends Algo Payment txn and updates the balance for idle stake to claim
  mintRequest(mintTxn: PayTxn): void {
    assert(mintTxn.amount >= ALGORAND_BASE_FEE, 'minimum amount to stake is 0.001 Algo');
    verifyPayTxn(mintTxn, {
      receiver: this.app.address,
    });
    this.idleAlgoToStake.value += mintTxn.amount;
    const minted = this.getMintAmount(mintTxn.amount);
    sendAssetTransfer({
      xferAsset: this.vALGOid.value,
      assetReceiver: this.txn.sender,
      assetAmount: minted,
    });
    this.totalAlgoStaked.value += mintTxn.amount;
    this.circulatingSupply.value += minted;
  }

  // user burn vALGO, sends Asset Transfer each at the time depending on the burn queue
  // MAYBE assert that the amount requested is < Algo balance as a sanity check, but assuming normal operations this shouldn't be a problem.
  burnRequest(amount: AssetTransferTxn): void {
    // totalAlgoStaked --
    // vALGO circ supply --
    // take burn queue
    // iterate and subtract from the request the amount you can take, stop when order is filled
    // if the order is not filled send back the remaining amount of vALGO
  }

  mintValidatorCommit(validatorAppID: AppID, stakeCommit: PayTxn): void {
    assert(this.isPool(validatorAppID));
    const operatorAddress = validatorAppID.globalState('operatorAddress') as Address;
    verifyPayTxn(stakeCommit, {
      sender: operatorAddress,
      receiver: this.app.address,
    });

    // ask again if when you embed a Txn you need to make a group or does this also submit the txn as part of the methodCall
    sendMethodCall<typeof CaelusValidatorPool.prototype.addToOperatorCommit>({
      applicationID: validatorAppID,
      methodArgs: [
        {
          sender: this.app.address,
          receiver: validatorAppID.address,
          amount: stakeCommit.amount,
          fee: 0,
        },
      ],
    });

    const amountToMint = this.getMintAmount(stakeCommit.amount);
    this.calculateLSTRatio();
    sendAssetTransfer({
      xferAsset: this.vALGOid.value,
      assetReceiver: validatorAppID.address,
      assetAmount: amountToMint,
      fee: 0,
    });
    this.totalAlgoStaked.value += stakeCommit.amount;
    this.circulatingSupply.value += amountToMint;
  }

  // burn & send to operator
  burnValidatorCommit(): void {
    // just like a burn but start to take from the operator app
  }

  // when operator is delinquent set up burn of his LST amount in the App Account
  // burn & send to validator app
  burnToDelinquentValidator(burnTxn: AssetTransferTxn, validatorAppID: AppID): void {
    // get AssetTransferTxn as burn type
    // check that app is delinquent
    // check that app is pool
    // init burn request for the amount sent
  }

  // when operator clears delinquency remint the LST burned
  reMintDeliquentCommit(amount: uint64, app: AppID): void {
    // get amount and check with operator commit
    // check that app is not delinquent anymore & his vAlgo amount is 0
    // send vAlgo amount corresponding to the current peg for the operatorCommit amount
    this.isPool(app);
    const opAmount = app.globalState('operatorCommit') as uint64;
    const op = app.globalState('operatorAddress') as Address;
    const delnQ = app.globalState('isDelinquent') as boolean;
    const isRightAmount = amount === opAmount;
    const isRightOp = op === this.txn.sender;
    const isNotDelinquent = !delnQ;
    const hasNovAlgo = app.address.assetBalance(this.vALGOid.value) === 0;
    const amountToMint = this.getMintAmount(amount);
    assert(isNotDelinquent && hasNovAlgo && isRightOp && isRightAmount);
    this.calculateLSTRatio();
    sendAssetTransfer({
      xferAsset: this.vALGOid.value,
      assetReceiver: app.address,
      assetAmount: amountToMint,
      fee: 0,
    });
    this.circulatingSupply.value += amountToMint;
  }

  // called to bid new validator as highest bidder
  // No assert call to avoid future P2P spam. Come back to this before final release.
  // TODO weird compilation error for exist value
  bid(validatorAppID: AppID): void {
    assert(this.isPool(validatorAppID));
    const valueC = validatorAppID.globalState('saturationBuffer') as uint64;
    const [valueB, existsB] = this.highestBidder.value.globalState('saturationBuffer') as uint64[]; // Error framePointer? Ask Joe
    if (valueC > valueB || existsB === 0) {
      this.highestBidder.value = validatorAppID;
    }
  }

  // called to send the Algo used to mint vALGO to the highest bidder
  delegateStake(amount: uint64, validatorAppID: AppID): void {
    assert(this.isPool(validatorAppID));
    assert(validatorAppID === this.highestBidder.value, 'can only delegate to highest bidder account');
    assert(amount <= this.idleAlgoToStake.value, 'cant withdraw more than the amount of idleAlgo in the contract');
    sendMethodCall<typeof CaelusValidatorPool.prototype.addStake, void>({
      applicationID: validatorAppID,
      methodArgs: [
        {
          receiver: validatorAppID.address,
          amount: amount,
          fee: 0,
        },
      ],
    });
    this.idleAlgoToStake.value -= amount;
  }

  // used to set new validator inside the burn queue
  snitch(app: AppID): void {
    assert(this.isPool(app));
    const satSnitch = app.globalState('saturationBuffer') as uint64;
    const satPrio = this.burnPrio.value.globalState('saturationBuffer') as uint64;
    let minPrio = app;
    if (satSnitch > satPrio) {
      minPrio = this.burnPrio.value;
      this.burnPrio.value = app;
    }
    const queueBytes = this.burnQueue.value;
    const queue = queueBytes as AppID[]; // how to change bytes into AppID[] bytes -> uint64[]
    // for loop on the queue of addresses checking saturation vs minPrio
    // iterate and check values
    // if higher -> replace and push new queue

    // highet 700 <-> 680
    // [500, 640,350,750...] --> [....]
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
            fee: 0,
          },
        ],
        fee: 0,
      });
      return;
    }
    verifyPayTxn(restakeTxn, {
      sender: snitchedApp.address,
      receiver: this.app.address,
    });
    this.idleAlgoToStake.value += restakeTxn.amount;
  }

  // operator calls for its own app *check*; clawback all delegated stake and ensure that the operator receives the ASA, he will proceed to burn
  onOperatorExit(appToClose: AppID, closeTxn: PayTxn): void {
    const operator = appToClose.globalState('operatorAddress') as Address;
    const totalCheck =
      (appToClose.globalState('operatorCommit') as uint64) + (appToClose.globalState('delegatedStake') as uint64);
    assert(this.txn.sender === operator, 'Only the operator can close out the contract');
    verifyPayTxn(closeTxn, {
      receiver: this.app.address,
      sender: appToClose.address,
      amount: totalCheck,
    });
    this.idleAlgoToStake.value += closeTxn.amount;
    sendMethodCall<typeof CaelusValidatorPool.prototype.deleteApplication, void>({
      applicationID: appToClose,
      methodArgs: [],
    });
  }

  declareRewards(txn: PayTxn): void {
    assert(txn.receiver === this.app.address, 'payment must be done to this app address');
    const protocolCut = (PROTOCOL_COMMISSION * txn.amount) / 100;
    const restakeRewards = txn.amount - protocolCut;
    sendPayment({
      receiver: this.vestigeAddress.value,
      amount: protocolCut,
      fee: 0,
    });
    this.idleAlgoToStake.value += restakeRewards;
    this.totalAlgoStaked.value += restakeRewards;
  }

  snitchCheck(appToCheck: AppID, params: SnitchInfo): boolean {
    assert(this.isPool(appToCheck));
    assert(this.isPool(params.recipient) || params.recipient.address === this.app.address);

    return sendMethodCall<typeof CaelusValidatorPool.prototype.getSnitched, boolean>({
      applicationID: appToCheck,
      methodArgs: [params],
    });
  }

  // TODO : CHECK FOR THE SUBSEQUENT APPID FL WITH FL HAPPENING AFTER THE CHECKBALANCE
  // TODO : DOCUMENT ON THE EVENTUAL SDK HOW THE FEE STRUCTURE WORKS TO AVOID SOMEONE YEETING THEIR NETWORTH ON A FLASH LOAN FEE
  makeFlashLoanRequest(payFeeTxn: PayTxn, amounts: uint64[], appToInclude: AppID[]): void {
    this.getFLcounter();
    this.flashLoanCounter.value += appToInclude.length;
    const keepFee = this.flashLoanCounter.value + FLASH_LOAN_FEE;

    verifyPayTxn(payFeeTxn, {
      receiver: this.app.address,
      amount: keepFee,
    });

    this.idleAlgoToStake.value += keepFee;

    assert(amounts.length === appToInclude.length, 'array length [amount, appToInclude] mismatch');
    // Ask Joe if this.pendingGroup creates a new txn group or appends it as an inner.
    for (let i = 0; i < appToInclude.length; i += 1) {
      this.pendingGroup.addMethodCall<typeof CaelusValidatorPool.prototype.flashloan, void>({
        applicationID: appToInclude[i],
        methodArgs: [amounts[i], this.txn.sender],
        fee: 0,
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

  creatorChangeCreatorRelatedParams(newVestigeAddress: Address): void {
    assert(this.txn.sender === this.app.creator);
    this.vestigeAddress.value = newVestigeAddress;
  }

  private isPool(app: AppID): boolean {
    const isPool = (app.globalState('creator') as AppID) === this.app;
    return isPool;
  }

  private minBalanceForAccount(
    contracts: uint64,
    extraPages: uint64,
    assets: uint64,
    localInts: uint64,
    localBytes: uint64,
    globalInts: uint64,
    globalBytes: uint64
  ): uint64 {
    let minBal = ALGORAND_ACCOUNT_MIN_BALANCE;
    minBal += contracts * APPLICATION_BASE_FEE;
    minBal += extraPages * APPLICATION_BASE_FEE;
    minBal += assets * ASSET_HOLDING_FEE;
    minBal += localInts * SSC_VALUE_UINT;
    minBal += globalInts * SSC_VALUE_UINT;
    minBal += localBytes * SSC_VALUE_BYTES;
    minBal += globalBytes * SSC_VALUE_BYTES;
    return minBal;
  }

  private costForBoxStorage(totalNumBytes: uint64): uint64 {
    const SCBOX_PERBOX = 2500;
    const SCBOX_PERBYTE = 400;

    return SCBOX_PERBOX + totalNumBytes * SCBOX_PERBYTE;
  }
}
