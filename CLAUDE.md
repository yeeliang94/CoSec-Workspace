# CLAUDE.md

Read [AGENTS.md](AGENTS.md) for project instructions and [DESIGN.md](DESIGN.md) before any UI change.

Key rules:

- The application is desktop only. Validate UI changes at desktop widths (1280px and 1440px). Do not check or build mobile or tablet layouts.
- Run Playwright tests only when the owner asks for them in the current task, including during reviews.
- The owner tests real runs in a Windows enterprise environment that can pull from GitHub but cannot push. Name any run that only works there as unverified. When you need something from it, write one self-contained instruction block the owner can paste to the agent there, including exactly what output to send back.
- Follow the "Refresh rules (30 October 2026)" in DESIGN.md: no top bar, no counts on tabs or navigation, no middle dots, plain-text statuses without dots, one line per table cell, subtle whitespace section separation, one-line warnings with an icon, and the three action tiers.
