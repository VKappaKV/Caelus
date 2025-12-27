export type PartKey = {
  votingKey: Uint8Array;
  selectionKey: Uint8Array;
  stateProofKey: Uint8Array;
  firstRound: bigint;
  lastRound: bigint;
  keyDilution: bigint;
};
