# E-INK HACKER NEWS

A signboard for the Kindle: the day's news, one story per screen, changing every
15 seconds. It is a static site - `tools/fetch-feeds.mjs` extracts the stories
from RSS, `tools/summarize.mjs` writes a two-sentence summary of each one
through OpenRouter, and the page presents them as a newspaper front page that
turns by itself.

```sh
npm install
npm run news      # RSS -> src/data/news.json (+ images, + AI summaries)
npm run build     # -> dist/ (one edition per browser turn)
npm run render    # -> dist/kindle/ (the slide pictures the plugin downloads)
npm run serve     # http://<this-machine-ip>:8080/
```

The machine needs its firewall to allow the port:

```sh
sudo ufw allow 8080/tcp
```

## The board

- `/` is the signboard: eight slides, one per screen, each visible for 8
  seconds, in a loop.
- Every slide carries the masthead, the section, a headline, the picture, the
  summary and the feed's own text underneath.
- The rotation is a **timer in the page's ES5 script**, not a CSS animation:
  the Kindle's browser does not run CSS animations, and the board would sit on
  the first story forever (it did). A browser with JavaScript off still sees the
  first slide.

## The edition

`feeds.json` holds the sections and their feeds - **every feed of the
[World Monitor](https://github.com/koala73/worldmonitor) project** (AGPL-3.0),
imported from its curated list by `tools/import-worldmonitor-feeds.mjs` and
grouped by the category that project files them under (293 feeds in 35
sections: Politics, Europe, Asia, Tech, AI, Finance, Energy, and so on).

```json
{ "name": "Tech", "feeds": [{ "name": "Ars Technica", "url": "https://feeds.arstechnica.com/arstechnica/technology-lab" }] }
```

The same file carries the knobs, because a board with hundreds of stories has
to be bounded somewhere - on purpose, not by accident:

| Key | Default | What it does |
|---|---|---|
| `max_slides` | 200 | stories on the board, newest first |
| `require_image` | true | only stories with a picture make the board |
| `items_per_feed` | 2 | how many stories a single feed may contribute |
| `max_images` | 150 | pictures when `require_image` is off |
| `max_downloads` | 500 | how many pictures to try before giving up on filling the board |
| `require_image` | true | a story without a picture is dropped |
| `render_slides` | 100 | how many the renderer photographs for the plugin |
| `summaries_per_run` | 40 | how many AI summaries one run may write |
| `summaries_model` | `nex-agi/nex-n2.5-pro:free` | the model to use |
| `summaries_fallback` | false | `false`: only that model, no others |
| `summaries_concurrency` | 3 | summaries in flight at once |
| `seconds` | 8 | how long each story stays on screen |
| `profiles` | `[[600,800]]` | the panels the renderer prints for |

`npm run build` never re-fetches: the edition is whatever `npm run news` last
wrote (the build refuses to run without one), so a rebuild is offline and the
summaries are not paid for twice.

Feeds are polled twelve at a time (`FEED_CONCURRENCY`), pictures four at a time,
and the whole collection takes under a minute.

**Only sources that carry pictures.** `tools/filter-feeds.mjs` probes every
imported feed once and keeps the ones whose stories come with an image; the rest
go to `feeds.no-images.json` (nothing is lost - import again and re-filter).
With `require_image` on, a story whose picture cannot be downloaded is dropped
too, so the board never shows an empty frame. Re-run the filter after importing
a new feed list:

```sh
node tools/filter-feeds.mjs        # 293 -> 170 feeds, in a minute
```

`tools/fetch-feeds.mjs` is dependency-free (fetch plus a few regexes, which
covers RSS 2.0 and Atom). It picks eight stories - at most two per section, so
one busy feed cannot crowd out the others - downloads each picture locally (the
Kindle never makes an external request; its TLS stack is too old and the Wi-Fi
is slow), converts them to *grayscale* PNGs when ImageMagick is around, and
keeps the feed text as the slide's description.

If every feed fails, the previous edition is kept; if there is none, a sample
edition is written, so `npm run build` always has something to show.

### The summaries

`tools/summarize.mjs` asks OpenRouter for two plain sentences per story, in
English, using a single model that `tools/benchmark-models.mjs` picked by
throughput - measured on usable answers only, because some fast models answer
with their own reasoning. With `summaries_model` pinned and
`summaries_fallback: false` there are no fallbacks; the script validates every
answer (a line that stops mid-sentence is worse than no line). It writes a handful per run - `summaries_per_run`, 40 by
default - and caches each line by headline in `src/data/summaries.json`
(git-ignored), so nothing is ever asked twice and the board fills up over the
following runs. A story with no summary yet shows the feed's own text alone.

The key is never in the repository:

```sh
export OPENROUTER_API_KEY=sk-or-...      # or put it in .openrouter-key
```

`.openrouter-key` is git-ignored. Without a key the edition still builds, just
without the summaries.

## Reading it on the Kindle

Two ways in, and they share the same server.

**The experimental browser** (this is the signboard): open
`http://<this-machine-ip>:8080/` and leave it - the page turns itself. Every
slide change is a full-screen repaint, which is exactly what e-ink does well.
Only the picture of the story on screen is fetched (the rest wait as `data-src`
attributes), and the page reloads itself every ten minutes to pick up the next
edition.

**The KOReader plugin** (`prophet.koplugin/`): KOReader cannot render HTML, so
the server photographs each slide and the plugin shows the pictures - one per
screen, tap the left or right third to move on, middle tap for the buttons.

```sh
cp -r prophet.koplugin /path/to/koreader/plugins/     # over USB: koreader/plugins/
```

Restart KOReader, then:

1. **Tools -> E-INK HACKER NEWS: server** - type `http://<this-machine-ip>:8080`
   once; it is remembered;
2. **Tools -> E-INK HACKER NEWS** - the edition opens.

The plugin asks the server for `edition.json` every 20 seconds while it is open
(`Edition.watch_seconds`), so when a new edition is rendered the Kindle picks it
up by itself. Pages are downloaded **one at a time**, as the viewer asks for
them - an edition can be a hundred slides, and the Kindle's radio is slow. The
plugin only has to be copied to the Kindle once.

## One screen per slide, and fixed positions

The panels this board is printed for are `600x800` (a KT4 in portrait, which is
how KOReader reads it) and `800x600` (landscape). The slide type is set in `vh`,
so it follows whatever the visible viewport turns out to be, and the plugin asks
the device for its screen size and downloads the matching rendering.

Inside a slide, every block - masthead, section, headline, picture, summary,
description, byline - has a **fixed height**, so a long headline can never push
the story down the screen. What gives is the font: a 20-line ES5 script at the
foot of the page (the only JavaScript in the project) shrinks the type inside
those boxes until it fits. CSS cannot measure text, and the checker keeps that
script to one inline ES5 block under 2 KB.

`tools/render-pages.mjs` screenshots the standing-still version of each slide
(`/slides/1.html`, `/slides/2.html`, ... - not linked from anywhere) at each
panel size, and writes `dist/kindle/<panel>/page-NN.png` plus the
`edition.json` the plugin reads.

## Hosting it on Vercel

The board is deliberately static (the Kindle wants one plain HTML file), so
there is **no server-side at runtime** - and there does not need to be. The
routine runs *inside the build*:

```
Vercel build  ->  npm run news   (RSS, pictures, AI summaries)
              ->  npm run build  (the static board)
```

- `vercel.json` sets exactly that as the build command. Import the repository in
  Vercel, add `OPENROUTER_API_KEY` as an environment variable, and every
  deployment ships a freshly collected edition.
- Deploy Hooks + `.github/workflows/refresh.yml` make it repeat: the workflow
  asks Vercel to build again every 20 minutes (create a Deploy Hook for `main`
  and store its URL as the `VERCEL_DEPLOY_HOOK` repository secret).
- Nothing generated is committed: `src/data/news.json` and `public/img/news/`
  stay git-ignored, and the pictures are produced during the build and served
  from Vercel's CDN, so the repository never grows with the news.

What does **not** go to Vercel is `npm run render`: photographing the slides for
the KOReader plugin needs Chromium, which serverless builders do not have. The
plugin keeps pointing at a machine that runs the full pipeline - or at this
same Vercel deployment for the browser, which is the part it was built for.

If you would rather not rebuild to refresh, the alternative is Vercel Cron Jobs
calling a serverless route that fetches the news itself and stores the edition
in Vercel Blob, with the board rendering on demand. It works, but it needs
storage, a function, and the same AI key - more moving parts for a page whose
whole charm is being one static file.

## Keeping it fed (locally)

```sh
npm run feed        # one round: news + build + render
npm run auto-feed   # the same round every 10 minutes, for as long as it runs
```

(For the LAN setup: the machine that serves the board and the KOReader slides is
also the one that collects the news.)

`tools/auto-feed.sh` loops (default 10 minutes, `sh tools/auto-feed.sh 5` for a
tighter cycle) and appends to `/tmp/prophet-feed.log`. Leave it running and the
board keeps filling: new stories arrive, pictures are fetched, and a few more
summaries are written each round. In the background:

```sh
setsid nohup npm run auto-feed > /tmp/prophet-feed.log 2>&1 &
```

## Files

```
feeds.json                sections, their feeds, and the masthead text
astro.config.mjs          static output, CSS inlined, no toolbar
src/pages/index.astro     the board: all slides, stacked, CSS rotation
src/pages/slides/[n].astro  one slide, standing still (for the renderer)
src/components/SignSlide.astro   one slide
src/layouts/Sign.astro    the shell
src/styles/sign.css       the whole look, written for old WebKit
prophet.koplugin/         the KOReader app: downloads the pages, shows them
tools/fetch-feeds.mjs     every feed -> src/data/news.json (+ local images)
tools/import-worldmonitor-feeds.mjs   the World Monitor feed list -> feeds.json
tools/summarize.mjs       OpenRouter -> the summary of each slide (cached)
tools/auto-feed.sh        keeps running the whole pipeline
tools/render-pages.mjs    slides -> dist/kindle/<panel>/ (Chromium)
tools/serve.mjs           zero-dependency static server for the LAN
tools/check-legacy.mjs    compatibility and weight guard
tools/make-art.sh         redraws the illustrations and the favicon (benched)
tests/koreader-probe.lua  runs the plugin inside a real, headless KOReader
public/img/               the downloaded news images
```

## Checking it

```sh
npm run check     # tools/check-legacy.mjs
```

The checker fails if the page uses SVG, web fonts or CSS grid, and keeps
JavaScript to a single inline ES5 block under 2 KB (the type fitter; the
bundler would otherwise rewrite it into ES6, which the Kindle's browser cannot
parse). It also enforces the weight budgets (HTML <= 60 KB, image <= 120 KB, the
board <= 2.5 MB). The repo's `dev-tools/check.sh` covers the shell and Markdown
in here.

The plugin is exercised inside a real KOReader, headless:

```sh
npm run build && npm run render && npm run serve &     # the paper must be up
PROPHET_DIST=$PWD/hogwarts-newspaper/dist/kindle \
    sh dev-tools/koreader-headless.sh hogwarts-newspaper/prophet.koplugin \
        hogwarts-newspaper/tests/koreader-probe.lua
```

That probe is what keeps the watching honest: it edits the served `edition.json`
in the middle of the test and asserts that the viewer replaces itself.

## Notes

- The masthead text lives in `feeds.json` (`masthead`, `tagline`, `edition`,
  `price`), and so does `seconds`, the time each story stays on screen.
- The bylines and datelines are fictional, assigned deterministically from the
  title: the same story keeps the same reporter between editions.
- Stories link to their original source. The Kindle forces underlines on every
  link, which is why the design does not fight it.

## License

MIT. See [LICENSE](LICENSE). The news belongs to the feeds it came from.
