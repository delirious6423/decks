# Decks Performance Fork

An independently maintained fork of [Decks by Paul Millerd](https://github.com/paulmil11/decks),
focused on large-deck responsiveness and repeated preview/export jobs. The fork is
maintained at [delirious6423/decks](https://github.com/delirious6423/decks). Its releases,
issues and update checks belong to this repository.

Create and review HTML slide decks locally. Edit slide text, leave comments, and copy
a prompt to your coding agent, such as Claude Code or Codex. The agent edits the file,
replies under the slide and exports a PDF. **Ask agent copies a prompt. The app does
not run a model or call a model API.**

## What this fork changes

- **Persistent browser worker.** Screenshots, audits, PDFs and thumbnails reuse Chrome,
  with a fresh browser context for each job.
- **Incremental network saves.** Changed fields and comments travel to the server
  without resending the complete state on every edit. Offline recovery remains.
- **Lazy slide rendering.** Large decks mount nearby slide bodies and wrappers as you
  navigate. The filmstrip, excluded-slide shelf and legacy sidebar avoid bulk work.
- **On-demand slide definitions.** Supported large slide libraries load in chunks,
  with gzip for large HTML and JSON responses.
- **Agent-neutral wording.** Prompts and review controls work with your chosen coding
  agent. Upstream attribution remains separate from the fork's identity.

Measured gains depend on the operation, deck size and cache state. The measurements
do **not** establish a 100× speedup for the whole app. See
[performance results, reproduction steps and Rust assessment](docs/PERFORMANCE.md).
No Rust rewrite is included.

## Install and run

Requirements: Python 3.9+, Node.js 18+, and macOS or Linux. Git is optional for running
the app and required for deck version history.

```bash
git clone https://github.com/delirious6423/decks.git decks-performance-fork
cd decks-performance-fork
./setup.sh
python3 server.py
```

Open [localhost:8790](http://localhost:8790/). The first start creates `~/slide-decks/`,
its `decks.json` registry and a demo deck. The server uses only the Python standard
library. `setup.sh` installs `playwright-core` in `tools/` and finds or installs a
Chromium browser for headless jobs. Use `SB_CHROME` to select an existing browser.

If Chrome needs Linux system libraries:

```bash
(cd tools && sudo npx playwright-core install-deps chromium)
```

### Update this fork

Pull from the fork remote and restart the server. Existing clones can check their
remote with `git remote -v`; `origin` should point to `delirious6423/decks` if they
intend to follow this fork. Review local changes before updating.

The dashboard shows the fork's version and links to [CHANGELOG.md](CHANGELOG.md).
Automatic checks look only for published releases in `delirious6423/decks`, once a
day. GitHub receives the request IP address, but no deck contents. A commit on `main`
does not create a release notification. Disable checks with `SB_CHECK_UPDATES=0` or
`"check_updates": false` in `config.json`.

## Create and review a deck

1. **Create.** Click **New deck**, choose a template and fill in the audience, point,
   length and style. Creation writes `BRIEF.md` and copies a prompt for your agent.
2. **Build.** Paste the prompt into your coding agent. The agent builds the first
   draft in the deck's HTML file.
3. **Review.** Edit text directly or leave a comment under a slide. Changes save next
   to the deck. **Still drafting** holds a comment out of the next round.
4. **Ask agent.** Copy the review prompt and paste it into your coding agent, or ask
   it to “process changes” with the bundled `decks` skill.
5. **Finish.** The agent checks the slides, exports a numbered PDF and records the
   round. Review the replies, then use **Looks good** or **Reopen**.

The app's shell updates on existing decks too. Their embedded engine and slide
content stay as authored. New decks get the latest engine and performance features.
A fresh install of this fork uses the same default decks directory as upstream.
Set a different `SB_DECKS_DIR` before first start if you want separate workspaces.

### Views and checks

| Control | Purpose |
|---|---|
| Focus (`F`) | One slide, comment and reply |
| Scroll (`S`) | Slides and review threads in order |
| Sorter (`G`) | Reorder slides and include or exclude them from a version |
| Checks (`C`, or `1`–`5`) | Five-second test, ten-second test, horizontal flow, vertical flow and layout guides |
| Titles only (`H`) | Review the argument through slide titles |
| New slide (`N`) | Choose a layout or copy a prompt to build one |
| `?` | Show help and shortcuts |

The version menu switches between cuts of the same deck. Checks inherit the original
project's consulting method: answer first, action titles, one idea per slide, and
evidence that supports the title. The method and consulting templates come from
[Paul Millerd / StrategyU](https://strategyu.co/).

### Templates and styling

| Template | Starting structure |
|---|---|
| `consulting` | Eight-slide storyline adapted from StrategyU's consulting templates |
| `talk` | Opening, three parts and a close |
| `workshop` | Training modules, exercises and facilitator pack |
| `proposal` | Situation, approach, team, fees and next steps |
| `blank` | Title, one part, two content slides and a close |

Choose Navy, Dark, Minimal, Forest, Teal or Plum, serif or sans serif titles, and an
optional logo. The deck's `deck-theme` style block controls its theme. Custom branding
can go in that block. See the [consulting template notes](templates/consulting/README.md)
for conversion details and limitations.

### Share and export

- **Client copy** in the ⋯ menu exports the current version as slides only, with its
  images embedded. Notes, comments, other versions and editing are excluded.
- **Editable copy** includes the complete deck, notes and comments for continued work.
- **Export PDF** prints a slide per page. `sb export` writes a numbered PDF and archives
  previous exports. Use `--with-edits` to include browser edits not yet baked into HTML.

Decks are HTML files in their own folders. Local images, uploaded assets, fonts and
scripts can accompany them. Do not assume that a raw HTML file is portable by itself
when it references external or neighboring assets. Export a bundled copy for sharing.
Template fonts may load from Google Fonts, and a custom deck may load remote assets.
Your coding agent sends the material it reads to its model provider according to that
agent's settings.

## Configuration

Copy `config.example.json` to `config.json`, or set environment variables. Environment
values win. The default listener is `127.0.0.1:8790`.

| Setting | Config key | Environment |
|---|---|---|
| Port | `port` | `SB_PORT` |
| Listen address | `host` | `SB_HOST` |
| Decks directory | `decks_dir` | `SB_DECKS_DIR` |
| Fork release checks | `check_updates` | `SB_CHECK_UPDATES` |
| Config file | | `SB_CONFIG` |
| CLI server URL | | `SB_URL` |
| Headless browser executable | | `SB_CHROME` |

`python3 server.py --port 8799` overrides the port for one run. `sb` uses the configured
port unless `SB_URL` is set. Browser worker and diagnostic switches are documented in
[Development and API](docs/DEVELOPMENT.md) and [Performance](docs/PERFORMANCE.md).

**Hide client work** is a dashboard filter for screen sharing. Mark a deck
`"client": true` or use `clientVersions` in its registry entry. It is not an account
system or a substitute for network access control.

## Agent and command-line workflow

`AGENTS.md` points coding agents to `.claude/skills/decks/SKILL.md`. The historical
skill name and path remain compatible. Claude Code can discover that skill directly;
other coding agents can read it through `AGENTS.md`. The copied prompt also includes
the steps, so the skill is not required just to use the prompt.

Run `./sb` from this checkout while the server is running:

```bash
./sb templates
./sb new "Q3 pricing review" --template consulting --audience "Leadership" \
  --point "Raise prices on the middle tier first." --style Navy
```

| Command | Purpose |
|---|---|
| `sb decks` | List decks and review status |
| `sb comments <deck> [--all]` | Read open comments, optionally including drafts |
| `sb edits <deck> [--version v]` | Read inline edits and slide moves |
| `sb working <deck> <slide>` | Mark a slide as being worked on |
| `sb reply <deck> <slide> done\|question\|skipped "text"` | Reply under a slide |
| `sb status <deck> "text"` / `sb idle <deck>` | Set or clear live progress |
| `sb shot <deck> <slide> ...` | Render screenshots |
| `sb audit <deck>` | Check overflow and layout guides |
| `sb export <deck> [--version v] [--with-edits]` | Export a numbered PDF |
| `sb round <deck> --summary "text"` | Record a review round |
| `sb commit <deck> "message"` | Commit the deck folder |
| `sb thumb <deck>` / `sb url <deck>` | Refresh thumbnail or print URL |
| `sb hide <deck>` / `sb show <deck>` | Change dashboard visibility |
| `sb delete <deck> --yes` | Trash app-created decks, or unregister external folders |

The `sb` CLI, `SB_*` variables, `.slidebuilder/` state and legacy `claude` API fields
keep their names for compatibility. They do not require a particular model provider.

## Optional login service

The existing service names stay `decks` to preserve installed setups.

Linux:

```bash
mkdir -p ~/.config/systemd/user
sed "s|__APP__|$PWD|g" contrib/decks.service > ~/.config/systemd/user/decks.service
systemctl --user enable --now decks
```

macOS:

```bash
sed -e "s|__APP__|$PWD|g" -e "s|__HOME__|$HOME|g" contrib/decks.plist > ~/Library/LaunchAgents/local.decks.plist
launchctl load ~/Library/LaunchAgents/local.decks.plist
```

## Development, attribution and license

See [Development and API](docs/DEVELOPMENT.md) for architecture, compatibility and safe
test commands. [Performance](docs/PERFORMANCE.md) keeps the detailed benchmark history,
raw data links, reproduction instructions and remaining bottlenecks.

Original Decks code and template content: **Paul Millerd / StrategyU**. Fork changes:
**delirious6423**. This is a separate maintenance line and does not claim upstream
endorsement. The inherited screenshots and illustrations in `docs/` show the upstream
interface and may contain its earlier wording.

Code is [MIT](LICENSE). Template content is [CC BY 4.0](LICENSE-templates), with its
original attribution retained and fork adaptations identified in the changelog.
Fonts and bundled third-party notices are in [NOTICE](NOTICE). Generated exports keep
the original deck engine copyright notice alongside the fork's provenance.
