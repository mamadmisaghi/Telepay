-- Watch the replacement project token, created externally by the new treasury.
-- This mint is separate from the launchpad's pool and its fee/claim ledger.
INSERT INTO official_mints(mint,expected_wallet,launch_id)
 VALUES('4iQ4WaAdsqokCd6mW9ntaY5UtFCGLZA8jCheCgS8TeLe',
        '9VrjF1yKhWECWo9Sp61KxiVySWjwaYsV3xWya3WE4NQz',
        'official-telepay-v2')
 ON CONFLICT(mint) DO NOTHING;
