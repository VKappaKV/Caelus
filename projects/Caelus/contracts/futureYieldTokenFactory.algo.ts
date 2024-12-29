import { Contract } from '@algorandfoundation/tealscript';
import { ASSET_HOLDING_FEE } from './constants.algo';

export class FutureYieldTokenFactory extends Contract {
  programVersion = 11;

  caelusAdmin = GlobalStateKey<AppID>({ key: 'caelusAdmin' });

  vAlgo = GlobalStateKey<AssetID>({ key: 'vAlgo' });

  @allow.bareCall('NoOp')
  createApplication(caelusAdmin: AppID, vAlgo: AssetID): void {
    this.caelusAdmin.value = caelusAdmin;
    this.vAlgo.value = vAlgo;
  }

  optIntoVAlgo(payMBR: PayTxn): void {
    verifyPayTxn(payMBR, {
      amount: ASSET_HOLDING_FEE,
    });
    sendAssetTransfer({
      xferAsset: this.vAlgo.value,
      assetReceiver: this.app.address,
      assetAmount: 0,
      fee: 0,
    });
  }

  // create token with maturity
  // 2y or 4y (not too many choices, that would lead to excessive fragmentation)

  // save each token reference as boxMap <AssetID, TokenInfo>
  /**
   * TokenInfo = {
   *  creation: timestamp,
   *  pegAtCreation: uint64,
   *  maturity: timestamp,
   *  pegAtMaturity: uint64
   * }
   */

  // mint principal token & yield token from LST
  // mint p & y from Algo amount (calls to above method)
  // method to mint post creation (account for peg difference and send the excessive Algo in the LST )

  // method to premint, store LST before creation timestamp -> allow instant mint execution from LST for the derivatives

  // method to burn at maturity
}
