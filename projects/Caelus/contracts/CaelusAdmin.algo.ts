/* eslint-disable import/no-cycle */
import { Contract } from '@algorandfoundation/tealscript';
import { CaelusValidatorPool } from './CaelusValidator.algo';
import {
  ALGORAND_ACCOUNT_MIN_BALANCE,
  ALGORAND_BASE_FEE,
  APPLICATION_BASE_FEE,
  ASSET_HOLDING_FEE,
  BURN_COOLDOW,
  BURN_QUEUE_LENGTH,
  CLAIM_DELAY,
  FLASH_LOAN_FEE,
  MintClaim,
  PROTOCOL_COMMISSION,
  SCALE,
  SnitchInfo,
  SSC_VALUE_BYTES,
  SSC_VALUE_UINT,
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

  initializedPoolContract = GlobalStateKey<boolean>({ key: 'initPoolContract' });

  validatorPoolContractVersion = GlobalStateKey<uint64>({ key: 'validatorPoolVersion' });

  validatorPoolContractApprovalProgram = BoxKey<bytes>({ key: 'validatorApprovalProgram' });

  manager = GlobalStateKey<Address>({ key: 'manager' });

  totalAlgoStaked = GlobalStateKey<uint64>({ key: 'totalstake' });

  idleAlgoToStake = GlobalStateKey<uint64>({ key: 'idleAlgo' }); // Algo deposited on Mint Request and yet to be distributed to the highest bidder

  init_vALGO = GlobalStateKey<boolean>({ key: 'init_vALGO' });

  // Vestige related params

  vestID = GlobalStateKey<AssetID>({ key: 'vestID' });

  stVestID = GlobalStateKey<AssetID>({ key: 'stVestID' });

  vestigeAddress = GlobalStateKey<Address>({ key: 'vestigeAddress' });

  // LST related

  pegRatio = GlobalStateKey<uint64>({ key: 'peg' });

  vALGOid = GlobalStateKey<AssetID>({ key: 'vALGOid' });

  circulatingSupply = GlobalStateKey<uint64>({ key: 'circulatingSupply' });

  // mint related

  highestBidder = GlobalStateKey<AppID>({ key: 'highestBidder' });

  mintOrders = BoxMap<Address, MintClaim>({ prefix: 'order', allowPotentialCollisions: false });

  // flashloan related Keys

  flashLoanCounter = GlobalStateKey<uint64>({ key: 'flashLoanCounter' });

  lastFlashloanBlock = GlobalStateKey<uint64>({ key: 'lastFlashloanBlock' });

  // burn related

  burnQueue = BoxKey<StaticArray<AppID, 10>>({
    key: 'burnQueue',
  });

  burnPrio = GlobalStateKey<AppID>({ key: 'burnPrio' });

  burnExhaust = GlobalStateKey<boolean>({ key: 'burnExhaust' });

  burnCooldownFromBlock = GlobalStateKey<uint64>({ key: 'burnCooldown' });

  // ----------------------------------------------------------------------------------------------------
  createApplication(): void {
    this.totalAlgoStaked.value = 0;
    this.init_vALGO.value = false;
    this.initializedPoolContract.value = false;
    this.validatorPoolContractVersion.value = 0;
    this.pegRatio.value = 1 * SCALE;
    this.circulatingSupply.value = 0;
    this.idleAlgoToStake.value = 0;
    this.flashLoanCounter.value = 0;
    this.vestigeAddress.value = this.app.creator;
    this.manager.value = this.app.creator;
    this.highestBidder.value = AppID.fromUint64(0);
  }

  creatorChangeCreatorRelatedParams(
    newVestigeAddress: Address,
    managerAddress: Address,
    vestID: AssetID,
    stVestID: AssetID
  ): void {
    assert(this.txn.sender === this.app.creator || this.txn.sender === this.vestigeAddress.value);
    this.vestigeAddress.value = newVestigeAddress;
    this.vestID.value = vestID;
    this.stVestID.value = stVestID;
    this.manager.value = managerAddress;
  }

  initPoolContract(programSize: uint64): void {
    assert(this.txn.sender === this.app.creator);
    assert(!this.initializedPoolContract.value, 'can only be initialized once');
    this.validatorPoolContractApprovalProgram.create(programSize);
    this.initializedPoolContract.value = true;
    this.validatorPoolContractVersion.value += 1;
  }

  writePoolContractProgram(offset: uint64, data: bytes): void {
    assert(this.txn.sender === this.manager.value);
    this.validatorPoolContractApprovalProgram.replace(offset, data);
  }

  updatePoolContract(programSize: uint64): void {
    assert(this.txn.sender === this.manager.value);
    if (this.validatorPoolContractApprovalProgram.size < programSize) {
      this.validatorPoolContractApprovalProgram.resize(programSize);
    }
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
    if (!this.burnQueue.exists) {
      const appIdArray = BoxKey<StaticArray<AppID, 10>>();
      appIdArray.value = [AppID.fromUint64(0)];
    }
    if (!this.burnPrio.exists) {
      this.burnPrio.value = AppID.fromUint64(0);
    }
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
      fee: 0,
    });

    this.validatorAddedEvent.log({
      operator: this.txn.sender,
      version: this.validatorPoolContractVersion.value,
    });
  }

  @abi.readonly
  calculateLSTRatio(): void {
    this.pegRatio.value = wideRatio([this.totalAlgoStaked.value, SCALE], [this.circulatingSupply.value]);
  }

  getMintAmount(amount: uint64): uint64 {
    this.calculateLSTRatio();
    return wideRatio([amount, SCALE], [this.pegRatio.value]);
  }

  getBurnAmount(amount: uint64): uint64 {
    this.calculateLSTRatio();
    return wideRatio([amount, this.pegRatio.value], [SCALE]);
  }

  delayedMintRequest(mintTxn: PayTxn): void {
    assert(mintTxn.amount >= ALGORAND_BASE_FEE, 'minimum amount to stake is 0.001 Algo');
    verifyPayTxn(mintTxn, {
      receiver: this.app.address,
    });
    this.idleAlgoToStake.value += mintTxn.amount;
    const minted = this.getMintAmount(mintTxn.amount);

    const mintOrder: MintClaim = {
      amount: minted,
      block: globals.round,
    };

    this.mintOrders(mintTxn.sender).value = mintOrder;
    this.totalAlgoStaked.value += mintTxn.amount;

    this.mintEvent.log({
      instant: false,
      amount: mintTxn.amount,
      output: minted,
    });
  }

  claimMint(): void {
    assert(
      this.mintOrders(this.txn.sender).value.block < globals.round - CLAIM_DELAY,
      'must wait 330 blocks after initial mint to claim the token'
    );
    const minted = this.mintOrders(this.txn.sender).value.amount;
    sendAssetTransfer({
      xferAsset: this.vALGOid.value,
      assetReceiver: this.txn.sender,
      assetAmount: minted,
      fee: 0,
    });
    this.circulatingSupply.value += minted;
  }

  instantMintRequest(mintTxn: PayTxn): void {
    assert(mintTxn.amount >= ALGORAND_BASE_FEE, 'minimum amount to stake is 0.001 Algo');
    verifyPayTxn(mintTxn, {
      receiver: this.app.address,
    });
    const premium = this.getPremiumAmount(mintTxn.amount);
    const minted = this.getMintAmount(mintTxn.amount - premium);
    sendAssetTransfer({
      xferAsset: this.vALGOid.value,
      assetReceiver: this.txn.sender,
      assetAmount: minted,
      fee: 0,
    });
    this.idleAlgoToStake.value += mintTxn.amount;
    this.circulatingSupply.value += minted;
    this.totalAlgoStaked.value += mintTxn.amount;

    this.mintEvent.log({
      instant: true,
      amount: mintTxn.amount,
      output: minted,
    });
  }

  getPremiumAmount(amount: uint64): uint64 {
    assert(this.txn.firstValid === globals.round - 330); // it will fail if it's not included
    let lookupRound = globals.round - 2 - 320; // -2 because of the delay for blocks[block] & 320 is the premium lookback we account for
    let accumulatedRewards = 0;
    for (let i = 0; i < 320; i += 1) {
      accumulatedRewards += blocks[lookupRound].proposerPayout;
      lookupRound += 1;
    }
    return wideRatio([amount, accumulatedRewards], [this.totalAlgoStaked.value]);
  }

  burnRequest(burnTxn: AssetTransferTxn, burnTo: Address): void {
    assert(burnTxn.assetAmount >= ALGORAND_BASE_FEE);
    verifyAssetTransferTxn(burnTxn, {
      xferAsset: this.vALGOid.value,
      assetReceiver: this.app.address,
    });
    // After exhaust flag there needs to be at least 1 block cooldown, if the queue is full, otherwise 10 rounds
    if (this.burnExhaust.value && !this.queueIsFull() && globals.round - this.burnCooldownFromBlock.value > 1) {
      assert(
        globals.round - this.burnCooldownFromBlock.value > BURN_COOLDOW,
        'wait at least 10 blocks since Exhaust Block'
      );
      this.burnExhaust.value = false;
    }
    const amtToBurn = this.getBurnAmount(burnTxn.assetAmount);
    let burning = 0;
    if (this.isPool(this.burnPrio.value)) {
      const dlgToPrio = this.burnPrio.value.globalState('delegatedStake') as uint64;
      if (dlgToPrio >= amtToBurn) {
        sendMethodCall<typeof CaelusValidatorPool.prototype.burnStake, void>({
          applicationID: this.burnPrio.value,
          methodArgs: [amtToBurn, burnTo],
          fee: 0,
        });
        if (this.isPool(this.burnQueue.value[0])) {
          this.snitchToBurn(this.burnQueue.value[0]);
        }
        return;
      }
      burning = this.burnPrio.value.globalState('delegatedSTake') as uint64;
      this.pendingGroup.addMethodCall<typeof CaelusValidatorPool.prototype.burnStake, void>({
        applicationID: this.burnPrio.value,
        methodArgs: [dlgToPrio, burnTo],
        fee: 0,
      });
    }
    for (let i = 0; i < this.burnQueue.value.length; i += 1) {
      const v = this.burnQueue.value[i];
      if (this.isPool(v)) {
        const dlgToV = v.globalState('delegatedSTake') as uint64;
        if (dlgToV < amtToBurn - burning) {
          this.pendingGroup.addMethodCall<typeof CaelusValidatorPool.prototype.burnStake, void>({
            applicationID: v,
            methodArgs: [dlgToV, burnTo],
            fee: 0,
          });
          burning += dlgToV;
        } else {
          this.pendingGroup.addMethodCall<typeof CaelusValidatorPool.prototype.burnStake, void>({
            applicationID: v,
            methodArgs: [amtToBurn - burning, burnTo],
            fee: 0,
          });
          burning = amtToBurn;
          break;
        }
      }
    }

    const amtLeft = this.getBurnAmount(amtToBurn - burning);
    if (amtLeft > 0) {
      this.pendingGroup.addAssetTransfer({
        xferAsset: this.vALGOid.value,
        assetAmount: amtLeft,
        assetReceiver: burnTxn.sender, // the sender needs to be the burnTxn sender, so when operator burns vALGO from the app it returns the amount left to burn
        fee: 0,
      });
      this.circulatingSupply.value -= burnTxn.assetAmount - amtLeft;
      this.totalAlgoStaked.value -= burning;
      this.burnExhaust.value = true;
      this.burnCooldownFromBlock.value = globals.round;

      this.burnEvent.log({
        filled: amtLeft > 0,
        amount: burnTxn.assetAmount - amtLeft,
        output: burning,
      });

      return;
    }
    this.totalAlgoStaked.value -= burning;
    this.circulatingSupply.value -= burnTxn.assetAmount;

    this.burnEvent.log({
      filled: amtLeft > 0,
      amount: burnTxn.assetAmount,
      output: burning,
    });
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
    sendAssetTransfer({
      xferAsset: this.vALGOid.value,
      assetReceiver: validatorAppID.address,
      assetAmount: amountToMint,
      fee: 0,
    });
    this.totalAlgoStaked.value += stakeCommit.amount;
    this.circulatingSupply.value += amountToMint;
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
      xferAsset: this.vALGOid.value,
      assetReceiver: this.app.address,
    });
    const opCmt = appToBurnFrom.globalState('operatorCommit') as uint64;
    assert(!(appToBurnFrom.globalState('isDelinquent') as boolean), 'con only burn when delinquency is solved');
    const toBurn = this.getBurnAmount(burnTxn.assetAmount);
    assert(opCmt < toBurn && opCmt - toBurn > globals.payoutsMinBalance, 'cannot burn more than the committed amount');
    sendMethodCall<typeof CaelusValidatorPool.prototype.removeFromOperatorCommit, void>({
      applicationID: appToBurnFrom,
      methodArgs: [toBurn],
    });
    this.totalAlgoStaked.value -= toBurn;
    this.circulatingSupply.value -= burnTxn.assetAmount;
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
    assert(globals.round - this.burnCooldownFromBlock.value > BURN_COOLDOW, "can only burn if we're not exhausted");
    assert(burnTxn.sender === validatorAppID.address);
    assert(burnTxn.xferAsset === this.vALGOid.value);
    assert(validatorAppID.globalState('isDelinquent') as boolean);
    let amountToUpdate = 0; // the ASA amount to give back if the burn request isnt filled && then reduce circ supply
    let toBurn = this.getBurnAmount(burnTxn.assetAmount);
    let amtBurned = 0; // need this to subtract from totalAlgoSupply
    if (this.isPool(this.burnPrio.value)) {
      const prioStake = this.burnPrio.value.globalState('delegatedStake') as uint64;
      amtBurned = prioStake >= toBurn ? prioStake : toBurn - prioStake;
      sendMethodCall<typeof CaelusValidatorPool.prototype.burnStake, void>({
        applicationID: this.burnPrio.value,
        methodArgs: [amtBurned, this.app.address],
        fee: 0,
      });
      toBurn -= amtBurned;
    }
    if (toBurn > 0) {
      for (let i = 0; i < this.burnQueue.value.length; i += 1) {
        const v = this.burnQueue.value[i];
        if (this.isPool(v)) {
          const dlgToV = v.globalState('delinquentStake') as uint64;
          if (dlgToV >= toBurn) {
            sendMethodCall<typeof CaelusValidatorPool.prototype.burnStake, void>({
              applicationID: v,
              methodArgs: [toBurn, this.app.address],
              fee: 0,
            });
            amtBurned += toBurn;
            toBurn = 0;
            break;
          } else {
            sendMethodCall<typeof CaelusValidatorPool.prototype.burnStake, void>({
              applicationID: v,
              methodArgs: [dlgToV, this.app.address],
              fee: 0,
            });
            amtBurned += dlgToV;
            toBurn -= dlgToV;
          }
        }
      }
    }
    amountToUpdate = this.getBurnAmount(toBurn - amtBurned);
    this.circulatingSupply.value -= burnTxn.assetAmount - amountToUpdate;
    this.totalAlgoStaked.value -= amtBurned;
    if (amountToUpdate > 0) {
      sendAssetTransfer({
        xferAsset: this.vALGOid.value,
        assetReceiver: burnTxn.sender,
        assetAmount: amountToUpdate,
        fee: 0,
      });
    }

    this.burnEvent.log({
      filled: amountToUpdate > 0,
      amount: burnTxn.assetAmount,
      output: amtBurned,
    });
  }

  // when operator clears delinquency remint the LST burned
  reMintDeliquentCommit(amount: uint64, app: AppID): void {
    // get amount and check with operator commit
    // check that app is not delinquent anymore & his vAlgo amount is 0
    // send vAlgo amount corresponding to the current peg for the operatorCommit amount
    this.isPool(app);
    assert(!(app.globalState('isDelinquent') as boolean), 'must solve delinquency first');
    assert(
      amount === (app.globalState('operatorCommit') as uint64),
      'amount need to be the full amount of operatorCommit'
    );
    assert((app.globalState('operatorAddress') as Address) === this.txn.sender);
    assert(
      app.address.assetBalance(this.vALGOid.value) === 0,
      'If the app already has vALGO it cannot mint with this method'
    );
    const amountToMint = this.getMintAmount(amount);
    sendAssetTransfer({
      xferAsset: this.vALGOid.value,
      assetReceiver: app.address,
      assetAmount: amountToMint,
      fee: 0,
    });
    this.circulatingSupply.value += amountToMint;

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
    const isDelegatable = validatorAppID.globalState('canBeDelegated') as boolean;
    if (this.isPool(this.highestBidder.value)) {
      this.highestBidder.value = validatorAppID;
      return;
    }
    const valueC = validatorAppID.globalState('saturationBuffer') as uint64;
    const valueB = this.highestBidder.value.globalState('saturationBuffer') as uint64;
    assert(isDelegatable, 'only bid delegatable Apps');
    if (valueC > valueB) {
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

  // used to set new validator inside the burn queue || burn Prio
  snitchToBurn(app: AppID): void {
    assert(this.isPool(app));
    const satSnitch = app.globalState('saturationBuffer') as uint64;
    let minPrio = app;
    let minSat = satSnitch;
    if (this.isPool(this.burnPrio.value)) {
      const satPrio = this.burnPrio.value.globalState('saturationBuffer') as uint64;
      if (satSnitch > satPrio) {
        minPrio = this.burnPrio.value;
        minSat = satPrio;
        this.burnPrio.value = app;
      }
    }
    const queue = this.burnQueue.value;
    for (let i = 0; i < queue.length; i += 1) {
      if (!this.isPool(queue[i])) {
        queue[i] = minPrio;
        break;
      }
      if ((queue[i].globalState('saturationBuffer') as uint64) < minSat) {
        const temp = minPrio;
        minPrio = queue[i];
        queue[i] = temp;
      }
    }

    this.snitchQueueEvent.log({
      prio: this.burnPrio.value,
      queue: this.burnQueue.value,
    });
    // for loop on the queue of addresses checking saturation vs minPrio
    // iterate and check values
    // if higher -> replace
  }

  multiSnitchToBurn(apps: AppID[]): void {
    for (let i = 0; i < apps.length; i += 1) {
      const v = apps[i];
      assert(this.isPool(v));
      this.snitchToBurn(v);
    }
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

  // operator calls for its own app; clawback all delegated stake and ensure that the operator receives the ASA, he will proceed to burn
  onOperatorExit(appToClose: AppID, closeTxn: PayTxn): void {
    verifyTxn(this.txn, {
      sender: appToClose.address,
      receiver: this.app.address,
    });
    this.idleAlgoToStake.value += closeTxn.amount;
    sendMethodCall<typeof CaelusValidatorPool.prototype.deleteApplication, void>({
      applicationID: appToClose,
      methodArgs: [],
      fee: 0,
    });
  }

  declareRewards(txn: PayTxn, ifValidator: uint64): void {
    assert(txn.receiver === this.app.address, 'payment must be done to this app address');
    let restakeRewards = txn.amount;
    assert(
      (this.isPool(AppID.fromUint64(ifValidator)) && AppID.fromUint64(ifValidator).address === this.txn.sender) ||
        ifValidator === 0,
      'either the caller is a Caelus Pool App or set the second param to 0 '
    );
    const protocolCut = wideRatio([PROTOCOL_COMMISSION, txn.amount], [100]);
    if (this.isPool(AppID.fromUint64(ifValidator))) {
      restakeRewards -= protocolCut;
      sendPayment({
        receiver: this.vestigeAddress.value,
        amount: protocolCut,
        fee: 0,
      });
    }

    this.idleAlgoToStake.value += restakeRewards;
    this.totalAlgoStaked.value += restakeRewards;
  }

  snitchCheck(appToCheck: AppID, params: SnitchInfo): boolean {
    assert(this.isPool(appToCheck));
    assert(this.isPool(params.recipient) || params.recipient.address === this.app.address);

    const result = sendMethodCall<typeof CaelusValidatorPool.prototype.getSnitched, boolean>({
      applicationID: appToCheck,
      methodArgs: [params],
      fee: 0,
    });

    this.snitchValidatorEvent.log({
      request: params,
      result: result,
    });

    return result;
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

  private isPool(app: AppID): boolean {
    return app.creator === this.app.address;
  }

  private queueIsFull(): boolean {
    const prioIsSet = this.isPool(this.burnPrio.value);
    let queueIsFull = true;
    for (let i = 0; i < this.burnQueue.value.length; i += 1) {
      queueIsFull = this.isPool(this.burnQueue.value[i]);
      if (!queueIsFull) {
        break;
      }
    }
    return prioIsSet && queueIsFull;
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
