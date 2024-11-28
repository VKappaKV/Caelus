import { Contract } from '@algorandfoundation/tealscript'
import { CaelusValidatorPool } from './CaelusValidator.algo'
import { FLASH_LOAN_FEE, PROTOCOL_COMMISSION } from './constants.algo'

/**
 * CaelusAdmin is the main contract handling the Caelus protocol.
 * Core Features:
 * - handling minting and burning of bsALGO
 * - keep the peg ratio bsALGO:ALGO
 * - auction for distribution on mint and clawback on burn
 * - force redistribution of stake
 * - deploy Validator Pool Contracts
 */
export class CaelusAdmin extends Contract {
  programVersion = 11

  //pegRatio = GlobalStateKey<ufixed<64, 2>>({ key: 'peg' })

  epochLen = GlobalStateKey<uint64>({ key: 'epochlen' }) // use to recalculate pegRatio?

  initializedPoolContract = GlobalStateKey<boolean>({ key: 'initPoolContract' }) // is box instantiated for Validator Approval Program?

  validatorPoolContractVersion = GlobalStateKey<uint64>({ key: 'validatorPoolVersion' }) // manager should be able to update this value

  totalAlgoStaked = GlobalStateKey<uint64>({ key: 'totalstake' })

  validatorPoolContractApprovalProgram = GlobalStateKey<bytes>({key:'validatorApprovalProgram'})

  init_bsALGO = GlobalStateKey<boolean>({ key: 'init_bsALGO' })

  highestBidder = GlobalStateKey<AppID>({ key: 'highestBidder'})

  idleAlgoToStake = GlobalStateKey<uint64>({key:'idleAlgo'})

  vestigeAddress = GlobalStateKey<Address>({ key: 'vestigeAddress'})
  
  flashLoanCounter = GlobalStateKey<uint64>({key:'flashLoanCounter'})

  // ----------------------------------------------------------------------------------------------------
    createApplication(): void {
    this.totalAlgoStaked.value = 0
    this.init_bsALGO.value = false
    this.initializedPoolContract.value = false
    this.validatorPoolContractVersion.value = 0
    //this.pegRatio.value = 1.0
  }

  // user mint bsAlgo, sends Algo Payment txn and updates the balance for idle stake to claim 
  mintRequest(): void{}
  // user burn bsAlgo, sends Asset Transfer each at the time depending on the burn queue
  burnRequest(): void{}

  // called to bid new validator as highest bidder
  bid(validatorAppID: AppID): void{
    const [valueC, existsC] = validatorAppID.globalState('saturationBuffer') as uint64[]
    const [valueB, existsB] = this.highestBidder.value.globalState('saturationBuffer') as uint64[]
    if (existsC && valueC > valueB || !existsB){
      this.highestBidder.value = validatorAppID
    }
  }
  // called to send the Algo used to mint bsALGO to the highest bidder
  delegateStake(amount: uint64, validatorAppID: AppID):void{
    // check that the Validator can receive rewards: delinquency + delegatability
  }

  // used to set new validator inside the burn queue
  snitch(): void{}
  // used to take the stake from current top validator of the burn queue
  burnStake():void{}

  declareRewards(txn: PayTxn): void{
    assert(txn.receiver === this.app.address, 'payment must be done to this app address')
    const protocolCut = (PROTOCOL_COMMISSION * txn.amount) / 100
    const restakeRewards = txn.amount - protocolCut
    sendPayment({
      receiver: this.vestigeAddress.value,
      fee: 0,
      amount: protocolCut
    })
    this.idleAlgoToStake.value += restakeRewards 
  }

  makeFlashLoanRequest(payFeeTxn: PayTxn, amounts: uint64[], appToInclude: AppID[]):void{

    assert(this.checkNoDoubleInFlashLoan(appToInclude), 'No Duplicate AppIDs in the same FlashLoan request') 

    this.flashLoanCounter.value += appToInclude.length
    const keepFee = (this.flashLoanCounter.value) + FLASH_LOAN_FEE

    verifyPayTxn(payFeeTxn, {
      receiver: this.app.address,
      amount: keepFee
    })

    this.idleAlgoToStake.value += keepFee

    assert(amounts.length === appToInclude.length, 'array lenght [amount, appToInclude] mismatch')
      
    for (let i = 0; i < appToInclude.length; i++){
      this.pendingGroup.addMethodCall<typeof CaelusValidatorPool.prototype.flashloan, void>({
        applicationID: appToInclude[i],
        methodArgs: [amounts[i], this.txn.sender],
        fee: 0
      })
    }
  }

  private checkNoDoubleInFlashLoan(apps: AppID[]): boolean{
    const uniqueSet = new Set(apps);
    return uniqueSet.size === apps.length
  }
}
