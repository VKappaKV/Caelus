import { Contract } from '@algorandfoundation/tealscript';

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

  pegRatio = GlobalStateKey<ufixed<64, 2>>({ key: 'peg' });

  epochLen = GlobalStateKey<uint64>({ key: 'epochlen' }); // use to recalculate pegRatio?

  initializedPoolContract = GlobalStateKey<boolean>({ key: 'initPoolContract' }); // is box instantiated for Validator Approval Program?

  validatorPoolContractVersion = GlobalStateKey<uint64>({ key: 'validatorPoolVersion' }); // manager should be able to update this value

  totalAlgoStaked = GlobalStateKey<uint64>({ key: 'totalstake' });

  validatorPoolContractApprovalProgram = GlobalStateMap<uint64, bytes>({
    maxKeys: 1,
    allowPotentialCollisions: false,
    prefix: 'ap'
  })

  init_bsALGO = GlobalStateKey<boolean>({ key: 'init_bsALGO' });

  // ----------------------------------------------------------------------------------------------------
    createApplication(): void {
    this.totalAlgoStaked.value = 0;
    this.init_bsALGO.value = false;
    this.initializedPoolContract.value = false;
    this.validatorPoolContractVersion.value = 0;
    this.pegRatio.value = 1.0;
  }
}
