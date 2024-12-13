# HOW TO CAELUS

Quick guide through CaelusAdmin.algo.ts & CaelusValidator.algo.ts to test out operations.

## CREATION

CaelusAdmin.algo.ts

1. createApplication()
2. initPoolContract()
3. initLST()
4. creatorChangeCreatorRelatedParams()

### VALIDATOR on creation

CaelusAdmin.algo.ts

1. addCaelusValidator()

CaelusValidator.algo.ts

2. optIntoLST()

CaelusAdmin.algo.ts

3. mintValidatorCommit()

CaelusValidator.algo.ts

4. goOnline()

### VALIDATOR on exit

CaelusValidator.algo.ts

1. makeCloseTxn()

After that the node operator address will be holding the LST amount of its commitment ready to be burned

CaelusAdmin.algo.ts

2. burnRequest()

### USER

1. instantMintRequest()
2. delayedMintRequest()
3. claimMint()
4. burnRequest()

### WATCHER

This role can be taken by either a validator App or any user.

CaelusAdmin.algo.ts

1. bid()
2. snitchToBurn()
3. multiSnitchToBurn()
4. declareRewards()
5. snitchCheck()
