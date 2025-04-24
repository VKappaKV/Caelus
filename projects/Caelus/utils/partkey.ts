interface InputData {
  'First round': bigint;
  'Last round': bigint;
  'Key dilution': bigint;
  'Selection key': string;
  'Voting key': string;
  'State proof key': string;
}

type PartKey = {
  firstRound: bigint;
  lastRound: bigint;
  keyDilution: bigint;
  selectionKey: Uint8Array;
  votingKey: Uint8Array;
  stateProofKey: Uint8Array;
};

// Function to decode base64 string to Uint8Array
function decodeBase64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Main function to convert the input data into partKey object
function createPartKey(input: InputData) {
  const partKey = {
    firstRound: input['First round'],
    lastRound: input['Last round'],
    keyDilution: input['Key dilution'],
    selectionKey: decodeBase64ToUint8Array(input['Selection key']),
    votingKey: decodeBase64ToUint8Array(input['Voting key']),
    stateProofKey: decodeBase64ToUint8Array(input['State proof key']),
  };

  return partKey;
}

// Example usage
const exampleInput: InputData = {
  'First round': 7751926n,
  'Last round': 12751926n,
  'Key dilution': 2237n,
  'Selection key': 'CeM6sx8K2+c+s7akrgSB9eFjF8/h7ch65jA9bdRu8fE=',
  'Voting key': 'cJ7GYm7+GDiklr6rUGDwiBsBvNXMkC9o9dWcOhv/CBw=',
  'State proof key': 'nhZULqq44dZeVogamW9JQO1qB/DfNt8n7uiiQAm0aeYT4ypRCzsrTGVzUQKMV/PscRq2LAbHYN37WRkDXG9tsQ==',
};

export const getPartKey = () => {
  const partKey: PartKey = createPartKey(exampleInput);
  return partKey;
};
