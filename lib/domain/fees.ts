/** Exact units for accounting. Convert to display-only numbers at the UI boundary. */
export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const RECIPIENT_BPS = 8_000n;
export const PROJECT_BPS = 2_000n;
const BASIS_POINTS = 10_000n;
const MAX_U64 = (1n << 64n) - 1n;

export function assertLamports(value: bigint, label = "Amount"): void {
  if (typeof value !== "bigint" || value < 0n || value > MAX_U64) {
    throw new RangeError(`${label} must be a non-negative u64 bigint in lamports.`);
  }
}

/** Split once per confirmed collection. Sub-lamport remainder belongs to the project. */
export function splitCreatorFees(receivedLamports: bigint) {
  assertLamports(receivedLamports, "Received fees");
  const recipientLamports = receivedLamports * RECIPIENT_BPS / BASIS_POINTS;
  return { receivedLamports, recipientLamports, projectLamports: receivedLamports - recipientLamports };
}

/** Pending claims reserve funds; a second request cannot reuse those funds. */
export function claimableBalance(earned: bigint, settled: bigint, reserved: bigint = 0n) {
  for (const amount of [earned, settled, reserved]) assertLamports(amount);
  if (settled + reserved > earned) throw new RangeError("Claims exceed the recipient allocation.");
  return earned - settled - reserved;
}
