import { Contract } from '@algorandfoundation/tealscript';
import { CaelusValidatorPool } from './CaelusValidator.algo';

/**
 * CaelusAdmin is the main contract handling the Caelus protocol.
 * Core Features:
 * - handling minting and burning of bsALGO;
 * - keep the peg ratio bsALGO:ALGO;
 * - auction for distribution on mint and clawback on burn;
 * - force redistribution of stake;
 * - deploy Validator Pool Contracts;
 */
export class CaelusAdmin extends Contract {
  programVersion = 11;

  //pegRatio = GlobalStateKey<ufixed<64, 2>>({ key: 'peg' });

  epochLen = GlobalStateKey<uint64>({ key: 'epochlen' }); // use to recalculate pegRatio?

  initializedPoolContract = GlobalStateKey<boolean>({ key: 'initPoolContract' }); // is box instantiated for Validator Approval Program?

  validatorPoolContractVersion = GlobalStateKey<uint64>({ key: 'validatorPoolVersion' }); // manager should be able to update this value

  totalAlgoStaked = GlobalStateKey<uint64>({ key: 'totalstake' });

  validatorPoolContractApprovalProgram = GlobalStateKey<bytes>({key:'validatorApprovalProgram'})

  init_bsALGO = GlobalStateKey<boolean>({ key: 'init_bsALGO' });

  // ----------------------------------------------------------------------------------------------------
    createApplication(): void {
    this.totalAlgoStaked.value = 0;
    this.init_bsALGO.value = false;
    this.initializedPoolContract.value = false;
    this.validatorPoolContractVersion.value = 0;
    //this.pegRatio.value = 1.0;
  }

  // user mint bsAlgo, sends Algo Payment txn and updates the balance for idle stake to claim 
  mintRequest(): void{}
  // user burn bsAlgo, sends Asset Transfer each at the time depending on the burn queue
  burnRequest(): void{}

  // called to bid new validator as highest bidder
  bid(validatorAppID: AppID): void{
    // TODO how to check a global state key-value from either caller or given AppID
    // check caller saturation buffer value
    // compare with current highest bidder  -> fail the txn or just make it return nothing (punish spam requests)
  /*   const [value, exists] = validatorAppID.globalState('saturationBuffer') as bytes
    if (exists){
      // check value with current highest bidder
    }
 */
  }
  // called to send the Algo used to mint bsALGO to the highest bidder
  delegateStake(amount: uint64):void{}

  // used to set new validator inside the burn queue
  snitch(): void{}
  // used to take the stake from current top validator of the burn queue
  burnStake():void{}
}
