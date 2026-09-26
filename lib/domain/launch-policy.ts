export const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const VANITY_POLICY = Object.freeze({
  requiredForAllLaunches: true,
  userCanDisable: false,
  requestedSuffix: "TeLe",
  // Exact spelling approved by the user on 2026-09-26.
  approvedSuffix: "TeLe" as string | null,
});

export function assertValidSuffix(suffix: string): void {
  if (!suffix || suffix.length > 12) throw new Error("Choose a Base58 suffix between 1 and 12 characters.");
  const invalid = [...suffix].filter(char => !BASE58_ALPHABET.includes(char));
  if (invalid.length) throw new Error(`Invalid Base58 character(s): ${[...new Set(invalid)].join(", ")}. Lowercase l, uppercase I/O, and 0 are excluded.`);
}

export function isSolanaAddress(address: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return false;
  let value = 0n;
  for (const char of address) value = value * 58n + BigInt(BASE58_ALPHABET.indexOf(char));
  let byteLength = 0;
  while (value > 0n) { byteLength++; value >>= 8n; }
  return (address.match(/^1*/)?.[0].length ?? 0) + byteLength === 32;
}

/** Formatting gate only: production must also verify the mint signer and on-chain launch. */
export function assertLaunchMint(address: string, suffix: string | null = VANITY_POLICY.approvedSuffix): void {
  if (suffix === null) throw new Error("The project mint suffix has not been approved. Launch is blocked.");
  assertValidSuffix(suffix);
  if (!isSolanaAddress(address)) throw new Error("Mint must be a 32-byte Base58 Solana address.");
  if (!address.endsWith(suffix)) throw new Error("Mint does not match the exact case-sensitive project suffix.");
}
