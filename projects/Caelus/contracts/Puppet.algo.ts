import { Contract } from '@algorandfoundation/tealscript';

export class Puppet extends Contract {
  @allow.create('DeleteApplication')
  spawn(): Address {
    sendPayment({
      receiver: this.txn.sender,
      amount: 0,
      rekeyTo: this.txn.sender,
    });
    return this.app.address;
  }
}
