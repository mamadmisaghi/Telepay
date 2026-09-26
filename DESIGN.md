# TelePay visual system

## Approved direction
The user approved the Graphite Blue palette mockup (option 1, 2026-09-26). Preserve the existing Inter typeface, layout, and detail density. Use neutral charcoal surfaces with the logo blue reserved for primary actions, Telegram headline, selected controls, verification, and earnings.

- Canvas #111316; sidebar #14171B; cards #1B1E23; elevated/hover #24282E; borders #30363D.
- Text #F2F5F7; secondary #A0A7B0; brand blue #1598F5; primary button text #07131D; blue wash #102738.
- Primary buttons, focus, charts and states share semantic CSS tokens across all routes and the VPS interface.
- Landing fee explanation is static, with no button semantics or hover affordance. Navigation shortcuts remain interactive.
- Top Tokens supports Recent, Market cap, Latest trade. Sort before paginating, reset page on sort changes. Preview trade ages are explicitly illustrative; never treat collection time as trade time.
- Inter 400–500, restrained heading weights, -0.035em tracking. Same font as existing site.
- Sidebar 232px desktop; header64px; content28px padding. Mobile drawer + two-column token grid.
- Split hero: left headline and launch, right Telegram claim steps. Slim 80/20/Solana band; compact navigation shortcuts.
- Preserve token grid, Telegram profiles, recent claims, rankings, collections and settlements. Avoid duplicate large preview grids.
- Final identity uses the supplied white T / blue arrow PNG; supplied blue square is the favicon.
- Net earnings are blue; gross collections and project revenue separately labeled. Public activity displays confirmed launches, finalized collections, and confirmed settlements only. Empty sections never display invented records.
- Product views retain all core detail. Docs now cover the Telegram mechanism with a full contents list.

Assets: public/telepaid-mark.png, public/telepaid-brand-sheet.png, public/telepaid-icon.png, existing public/token-art.png.

Final assets approved by user on 2026-09-26: supplied transparent white T with blue arrow for navigation; supplied blue square icon for browser favicon; supplied full brand sheet retained. These supersede the earlier hand-drawn geometric T. Preserve the supplied image content.

2026-09-26 quality update: navigation, footer and large marks now use the supplied clean blue icon directly as an image. The noisy transparent cutout is retained as a source asset, not displayed. Generated cleanup candidates did not improve fidelity and were not shipped.

Final user correction, 2026-09-26: use public/telepaid-mark.png, the supplied transparent white T with blue arrow, in every brand placement and favicon. No blue square background or colored tile. This supersedes the blue-icon quality fallback. Preserve the approved shape.
