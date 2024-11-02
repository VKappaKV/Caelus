import { Contract } from '@algorandfoundation/tealscript';

/**
 * Caelus Validator Pool Contract.
 */

export class CaelusValidatorPool extends Contract {
  programVersion = 11;

  creatorContractAppID = GlobalStateKey<AppID>({ key: 'creator' });

  nodeOperatorCommit = GlobalStateKey<uint64>({ key: 'operatorCommit' });

  algodVersion = GlobalStateKey<bytes>({ key: 'algodVersion' });

  validatorPoolContract_version = GlobalStateKey<uint64>({ key: 'poolContractVersion' });

  saturationBuffer = GlobalStateKey<uint64>({ key: 'saturationBuffer' });

  operatorAddress = GlobalStateKey<Address>({ key: 'operator' });
}
