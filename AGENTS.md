# CoSec Workspace

For UI, component, layout, typography or content-presentation changes, read [DESIGN.md](DESIGN.md) first. Option A Workbench is the owner's selected design, refined on 30 October 2026. Its tokens, component rules and the "Refresh rules" section are the visual authority.

For workflow, permission, record-state or completion changes, also read the applicable sections of [DESIGN_SPEC.md](DESIGN_SPEC.md). Keep legal and regulatory rules tied to approved sources and versions.

`prototype/index.html` is a disposable, dependency-free reference with fictional in-memory data. Normal use presents A. Retain B and C as archived explorations behind `?explore=1&variant=B|C`; they do not define new production themes. Follow the specification's full contracts rather than copying the prototype's reduced state model.

A visual prototype cannot establish legal applicability or complete a statutory obligation. Preserve unrelated local changes and validate the user path affected by each change.

## Validation

The application is used on desktop computers only. When validating UI work, check desktop widths (1280px and 1440px) with keyboard focus and real-length data. Do not test, screenshot or fix phone or tablet layouts (for example 390px or 768px). Run `npm run typecheck` and `npm test`. Run Playwright specs (`npm run test:e2e`) only when the owner asks for them or for a QA review in the current task, not as routine validation or as part of a code review. They use Playwright's own Chromium; if it is missing, run `npx playwright install chromium`. Start the app with `npm run dev`, not `./start.sh`, which opens the owner's browser.
