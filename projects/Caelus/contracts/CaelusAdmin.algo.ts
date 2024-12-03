/* eslint-disable import/no-cycle */
import { Contract } from '@algorandfoundation/tealscript';
import { CaelusValidatorPool } from './CaelusValidator.algo';
import { FLASH_LOAN_FEE, PROTOCOL_COMMISSION, SnitchInfo } from './constants.algo';

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

  circulatingSupply = GlobalStateKey<uint64>({ key: 'circulatingSupply' });

  highestBidder = GlobalStateKey<AppID>({ key: 'highestBidder' });

  idleAlgoToStake = GlobalStateKey<uint64>({ key: 'idleAlgo' });

  vestigeAddress = GlobalStateKey<Address>({ key: 'vestigeAddress' });

  // flashloan related Keys

  flashLoanCounter = GlobalStateKey<uint64>({ key: 'flashLoanCounter' });

  lastFlashloanBlock = GlobalStateKey<uint64>({ key: 'lastFlashloanBlock' });

  burnQueue = BoxKey<AppID[]>({
    key: 'burnQueue',
    dynamicSize: false,
  });

  // ----------------------------------------------------------------------------------------------------
  createApplication(): void {
    this.totalAlgoStaked.value = 0;
    this.init_vALGO.value = false;
    this.initializedPoolContract.value = false;
    this.validatorPoolContractVersion.value = 0;
    this.pegRatio.value = 1;
    // TODO FINISH UP CREATE APPLICATION METHOD
  }

  initPoolContract(programSize: uint64): void {
    assert(this.txn.sender === this.app.creator);
    this.validatorPoolContractApprovalProgram.create(programSize);
  }

  loadPoolContractProgram(offsett: uint64, data: bytes): void {
    assert(!this.initializedPoolContract.value);
    this.validatorPoolContractApprovalProgram.replace(offsett, data);
  }

  poolContractIsSet(): void {
    assert(this.txn.sender === this.app.creator);
    this.initializedPoolContract.value = true;
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

  // need to calculate the MBRs
  addCaelusValidator(mbrPay: PayTxn): void {
    verifyPayTxn(mbrPay, {
      receiver: this.app.address,
      // TODO CHECK AMOUNT
    });

    sendAppCall({
      onCompletion: OnCompletion.NoOp,
    });
  }

  // to calculate use totalAlgoStaked/LSTcirculatingSupply
  calculateLSTRatio(): void {
    // wide ratio SCALE value is...?
    this.pegRatio.value = wideRatio([this.totalAlgoStaked.value, 10000], [this.circulatingSupply.value]);
  }

  // user mint vALGO, sends Algo Payment txn and updates the balance for idle stake to claim
  mintRequest(mintTxn: PayTxn): void {
    verifyPayTxn(mintTxn, {
      receiver: this.app.address,
    });
    this.idleAlgoToStake.value += mintTxn.amount;
    this.calculateLSTRatio();
    const minted = this.getMintAmount(mintTxn.amount);
    sendAssetTransfer({
      xferAsset: this.vALGOid.value,
      assetReceiver: this.txn.sender,
      assetAmount: minted,
    });
    this.totalAlgoStaked.value += mintTxn.amount;
    this.circulatingSupply.value += minted;
  }

  getMintAmount(amount: uint64): uint64 {
    return wideRatio([amount], [this.pegRatio.value]); // TODO check math, SCALE?
  }

  getBurnAmount(amount: uint64): uint64 {
    return amount * this.pegRatio.value;
  }

  // user burn vALGO, sends Asset Transfer each at the time depending on the burn queue
  burnRequest(): void {
    // totalAlgoStaked --
    // vALGO circ supply --
    // take burn queue
    // iterate and subtract from the request the amount you can take, stop when order is filled
    // if the order is not filled send back the remaining amount of vALGO
  }

  mintValidatorCommit(validatorAppID: AppID, stakeCommit: PayTxn): void {
    assert(this.isPool(validatorAppID));
    const validatorAddress = validatorAppID.globalState('operatorAddress') as Address;
    verifyPayTxn(stakeCommit, {
      sender: validatorAddress,
      receiver: validatorAppID.address,
    });
    assert(validatorAppID.address === this.txn.sender);

    // Todo send ASA respective amount to the balance of the App
  }

  burnValidatorCommit(): void {
    // just like a burn but start to take from the operator app
  }

  // when operator is delinquent set up burn of his LST amount in the App Account
  burnToDelinquentValidator(): void {
    // get AssetTransferTxn as burn type
    // check that app is delinquent
    // check that app is pool
    // init burn request for the amount sent
  }

  // when operator clears delinquency remint the LST burned
  reMintDeliquentCommit(): void {
    // get PayTxn as Mint type
    // check that app is not delinquent anymore & his vAlgo amount is 0
    // send vAlgo amount corresponding to the current peg for the operatorCommit amount
  }

  // called to bid new validator as highest bidder
  // No assert call to avoid future P2P spam. Come back to this before final release.
  // TODO weird compilation error at for exist value
  bid(validatorAppID: AppID): void {
    assert(this.isPool(validatorAppID));
    const valueC = validatorAppID.globalState('saturationBuffer') as uint64;
    const [valueB, existsB] = this.highestBidder.value.globalState('saturationBuffer') as uint64[]; // Error framePointer?
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
    // this.burnQueue.extract(); extract box
    // for loop on the queue of addresses
    // iterate and check values
    // if higher -> replace and push new queue
  }

  // used to route txn both to restake into the auction or to another validator, depending on the receiver
  reStakeFromSnitch(snitchedApp: AppID, receiverApp: AppID, restakeTxn: PayTxn): void {
    assert(this.isPool(snitchedApp));
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

    assert(amounts.length === appToInclude.length, 'array lenght [amount, appToInclude] mismatch');
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
}
