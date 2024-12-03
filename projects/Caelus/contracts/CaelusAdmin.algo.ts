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

  // pegRatio = GlobalStateKey<ufixed<64, 2>>({ key: 'peg' })

  epochLen = GlobalStateKey<uint64>({ key: 'epochlen' }); // use to recalculate pegRatio?

  initializedPoolContract = GlobalStateKey<boolean>({ key: 'initPoolContract' }); // is box instantiated for Validator Approval Program?

  validatorPoolContractVersion = GlobalStateKey<uint64>({ key: 'validatorPoolVersion' }); // manager should be able to update this value

  totalAlgoStaked = GlobalStateKey<uint64>({ key: 'totalstake' });

  validatorPoolContractApprovalProgram = GlobalStateKey<bytes>({ key: 'validatorApprovalProgram' });

  init_vALGO = GlobalStateKey<boolean>({ key: 'init_vALGO' });

  vALGOid = GlobalStateKey<AssetID>({ key: 'vALGOid' });

  highestBidder = GlobalStateKey<AppID>({ key: 'highestBidder' });

  idleAlgoToStake = GlobalStateKey<uint64>({ key: 'idleAlgo' });

  vestigeAddress = GlobalStateKey<Address>({ key: 'vestigeAddress' });

  flashLoanCounter = GlobalStateKey<uint64>({ key: 'flashLoanCounter' });

  lastFlashloanBlock = GlobalStateKey<uint64>({ key: 'lastFlashloanBlock' });

  // ----------------------------------------------------------------------------------------------------
  createApplication(): void {
    this.totalAlgoStaked.value = 0;
    this.init_vALGO.value = false;
    this.initializedPoolContract.value = false;
    this.validatorPoolContractVersion.value = 0;
    // this.pegRatio.value = 1.0
  }

  initLST(): void {}

  // to calculate use totalAlgoStaked/LSTcirculatingSupply
  calculateLSTRatio(): void {}

  // user mint vALGO, sends Algo Payment txn and updates the balance for idle stake to claim
  mintRequest(): void {}

  // user burn vALGO, sends Asset Transfer each at the time depending on the burn queue
  burnRequest(): void {}

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

  burnValidatorCommit(): void {}

  burnToDelinquentValidator(): void {}

  reMintDeliquentCommit(): void {}

  // called to bid new validator as highest bidder
  // No assert call to avoid future P2P spam. Come back to this before final release.
  bid(validatorAppID: AppID): void {
    assert(this.isPool(validatorAppID));
    const [valueC, existsC] = validatorAppID.globalState('saturationBuffer') as uint64[];
    const [valueB, existsB] = this.highestBidder.value.globalState('saturationBuffer') as uint64[];
    if ((existsC !== 0 && valueC > valueB) || existsB === 0) {
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
  snitch(): void {}

  // used to take the stake from current top validator of the burn queue
  burnStake(): void {}

  reStakeFromSnitch(snitchedApp: AppID, restakeTxn: PayTxn): void {
    assert(this.isPool(snitchedApp));
    verifyPayTxn(restakeTxn, {
      receiver: this.app.address,
    });
    this.idleAlgoToStake.value += restakeTxn.amount;
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
    // check that recipient in params is pool or this app
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

  // calculate flash loan demand. Grows linear, decrease exponentially
  getFLcounter(): void {}

  // callable only by the creator address; possibility to change the vestige payout address
  creatorChangeCreatorRelatedParams(): void {}

  private isPool(app: AppID): boolean {
    const isPool = (app.globalState('creator') as AppID) === this.app;
    return isPool;
  }
}
