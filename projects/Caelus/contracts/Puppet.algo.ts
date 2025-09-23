import { Contract } from '@algorandfoundation/tealscript';

export class Puppet extends Contract {
  @allow.create('DeleteApplication')
  spawn(): Address {
    sendPayment({
      receiver: this.app.address,
      amount: 0,
      rekeyTo: globals.callerApplicationAddress,
    });
    return this.app.address;
  }
}
