import assert from 'node:assert/strict';
import test from 'node:test';
import {splitCreatorFees, claimableBalance} from '../lib/domain/fees.ts';
import {assertValidSuffix, assertLaunchMint, isSolanaAddress, VANITY_POLICY} from '../lib/domain/launch-policy.ts';

test('allocation conserves every lamport, including amounts beyond Number precision',()=>{
  for(const gross of [0n,1n,4n,5n,10_000_000_000n,9_007_199_254_740_999n,(1n<<64n)-1n]){
    const split=splitCreatorFees(gross);
    assert.equal(split.recipientLamports+split.projectLamports,gross);
    assert.equal(split.recipientLamports,gross*4n/5n);
  }
  assert.equal(splitCreatorFees(10_000_000_000n).recipientLamports,8_000_000_000n);
  assert.throws(()=>splitCreatorFees(-1n));
  assert.throws(()=>splitCreatorFees(100));
  assert.throws(()=>splitCreatorFees(1n<<64n));
});
test('pending withdrawals reduce available funds without applying the split twice',()=>{
  assert.equal(claimableBalance(8_000_000_000n,2_000_000_000n,1_000_000_000n),5_000_000_000n);
  assert.throws(()=>claimableBalance(8n,5n,4n));
});
test('invalid requested spellings fail before any key generation',()=>{
  for(const suffix of ['tele','Tele','0OIl','', 'x'.repeat(13)]) assert.throws(()=>assertValidSuffix(suffix));
  for(const suffix of ['TeLe','teLe','TELE']) assert.doesNotThrow(()=>assertValidSuffix(suffix));
  assert.equal(VANITY_POLICY.approvedSuffix,"TeLe");
  assert.equal(VANITY_POLICY.userCanDisable,false);
});
test('mint addresses are 32 bytes and suffix matching is case sensitive',()=>{
  const address='A'.repeat(40)+'TeLe';
  assert.equal(isSolanaAddress(address),true);
  assert.equal(isSolanaAddress('1'.repeat(32)),true);
  assert.equal(isSolanaAddress('1'.repeat(33)),false);
  assert.equal(isSolanaAddress('z'.repeat(44)),false);
  assert.doesNotThrow(()=>assertLaunchMint(address,'TeLe'));
  assert.throws(()=>assertLaunchMint(address,'teLe'));
  assert.doesNotThrow(()=>assertLaunchMint(address));
  assert.throws(()=>assertLaunchMint(address,null));
});
