# CoSec Workspace design exploration

Start with [the readable design specification](design-spec.html) or [the agent Markdown](DESIGN_SPEC.md), then open [the HTML prototype](prototype/index.html) directly in a browser. No installation is required.

For an HTTP preview, run from this directory:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Open http://127.0.0.1:8765/prototype/?variant=A and use the bottom A/B/C switcher. Left and right arrows also change direction when you are not editing a field.

- **A Workbench:** company-first table with next actions, deadlines and named owners.
- **B Review desk:** light navigation with a persistent company queue and case detail.
- **C Portfolio:** horizontal navigation, company files and an exceptions list.

Try the overdue appointment, annual return review, ready filing pack, company file and new job form. Use the top-right role selector to preview Reviewer and Lodger actions. All names and records are fictional; changes reset when the page reloads.

The design specification covers the complete product catalogue and production requirements. The prototype implements representative interactions, not the entire product. It has no real authentication, filing integration, legal deadline engine or persistent storage.

Manual checks covered desktop layouts and 390px mobile reflow, search and empty results, reviewer approval, document revision, external submission and new-job creation. Approval and submission remained separate from unresolved filing requirements. This is not a full accessibility or production security audit.

The October refinement applies the official [Impeccable](https://github.com/pbakaus/impeccable) skill’s polish and distill guidance. The current source passed its deterministic detector after correcting a tinted overlay shadow. The skill is installed at `~/.codex/skills/impeccable`. Previous screenshots are retained as `previews/before-*.jpg`.

## Git and GitHub

This project is stored in `~/Desktop/Corporate Secretarial Workspace` and has a local Git repository on branch `main`. The original working folder is retained separately.

The design sources, prototype, source brief and before/after screenshots are tracked. The ZIP download is retained in the folder and excluded from Git because it duplicates the editable files.

To publish later, create an empty GitHub repository without an initial README, license or gitignore, then connect its URL as the `origin` remote and push `main`. No remote is configured yet. The repository includes the original product brief; choose its visibility accordingly.
