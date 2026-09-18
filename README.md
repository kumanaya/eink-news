<p align="center">
  <img src="docs/banner.png" alt="E-INK NEWS — one story per screen" width="720" />
</p>

<h1 align="center">E-INK NEWS</h1>

<p align="center">
  <strong>One story per screen.</strong><br />
  The day's paper, turning itself on a Kindle.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Kindle-e--ink-111111?style=flat-square" alt="Kindle" />
  <img src="https://img.shields.io/badge/World%20Monitor-feeds-6b6b6b?style=flat-square" alt="World Monitor" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square" alt="MIT" /></a>
</p>

<p align="center">
  <a href="https://github.com/kumanaya/eink-news"><img src="https://img.shields.io/badge/GitHub-eink--news-1c1a17?style=flat-square&logo=github" alt="GitHub" /></a>
  <a href="https://x.com/danielkumanaya"><img src="https://img.shields.io/badge/X-danielkumanaya-1c1a17?style=flat-square&logo=x" alt="X" /></a>
  <a href="https://discord.gg/KYChSeuyk"><img src="https://img.shields.io/badge/Discord-E--INK%20HACK-5865F2?style=flat-square&logo=discord&logoColor=white" alt="Discord" /></a>
</p>

<p align="center">
  <a href="#on-the-kindle">On the Kindle</a>
  ·
  <a href="#on-your-desk">On your desk</a>
  ·
  <a href="#how-it-stays-fresh">How it stays fresh</a>
  ·
  <a href="#make-it-yours">Make it yours</a>
</p>

---

Open it and walk away. Every eight seconds the page becomes a new front:
masthead, section, headline, picture, two sentences, the feed's own line
underneath.

Tap the **left third** to go back. Tap the **right third** to go forward.
Same gesture as turning a Kindle page. The middle is for the link.

Politics, Europe, Asia, Tech, Finance — the
[World Monitor](https://github.com/koala73/worldmonitor) list, one picture
at a time, on a panel that loves a full-screen repaint.

---

## On the Kindle

Two doors. Same paper: [eink-news-nine.vercel.app](https://eink-news-nine.vercel.app/).

### Experimental browser

Open `https://eink-news-nine.vercel.app/` and leave it.

The board turns on its own. A tap on the side turns it by hand. Only the
picture on screen is fetched. Every ten minutes the page reloads for the
next edition.

### KOReader plugin

KOReader cannot draw HTML, so the server photographs each slide and the
plugin shows the pictures. It already knows the Vercel address.

```sh
cp -r einknews.koplugin /path/to/koreader/plugins/
```

Restart KOReader, then **Tools → E-INK NEWS**. The paper opens.

To host it yourself instead, set **Tools → E-INK NEWS: server** to that
URL (no trailing slash).

Left / right to turn. Middle tap for the buttons. While it is open it
checks for a new edition every 20 seconds, and pulls pages one at a time
(the radio is slow). Copy the plugin once. After that the Kindle follows
the server by itself.

---

## On your desk

```sh
npm install
npm run news      # stories, pictures, summaries
npm run build     # the static board
npm run render    # photos for the plugin
npm run serve     # http://<this-machine-ip>:8080/  (local only)
```

Kindle cannot see it? Open the port:

```sh
sudo ufw allow 8080/tcp
```

`npm run build` never goes online. It reads `src/data/news.json`, which
already lives in the repo.

Summaries need an OpenRouter key. Without one the board still builds —
the feed text stands in until the lines catch up.

```sh
export OPENROUTER_API_KEY=sk-or-...      # or drop it in .openrouter-key
```

`.openrouter-key` is git-ignored.

---

## How it stays fresh

A GitHub Action collects the paper every **30 minutes**: feeds, pictures,
a handful of AI summaries, then photographs the slides for the Kindle and
commits the lot. Vercel only runs `npm run build`. It never waits on a
model, and it never needs Chromium — the pictures are already in
`public/kindle/`.

Put `OPENROUTER_API_KEY` in the **GitHub** secrets. Vercel does not need it.

At home, for a local board:

```sh
npm run feed        # one round: news + build + render
npm run auto-feed   # the same, every 10 minutes
```

```sh
setsid nohup npm run auto-feed > /tmp/eink-news-feed.log 2>&1 &
```

Host the browser board on Vercel by importing the repo. The KOReader
plugin talks to that same site.

---

## Make it yours

Every block on the slide has a **fixed place**. A long headline shrinks.
It never shoves the story down. Pictures always fill the same frame.

A story without a picture does not make the board. A story without a
summary yet still does.

The masthead, the tagline and the eight-second turn live in `feeds.json`.
Bylines are fictional and stable — the same headline keeps the same
reporter. Stories link to their source. The Kindle underlines every link,
so the design does not fight it.

```json
{ "name": "Tech", "feeds": [{ "name": "Ars Technica", "url": "https://feeds.arstechnica.com/arstechnica/technology-lab" }] }
```

| Knob | Default | What it does |
| --- | --- | --- |
| `max_slides` | 200 | stories on the board, newest first |
| `require_image` | true | no picture, no slide |
| `items_per_feed` | 2 | cap per feed |
| `summaries_per_run` | 40 | AI lines written in one run |
| `seconds` | 8 | how long a story stays on screen |
| `profiles` | `[[600,800]]` | panel sizes to print |

After importing a new World Monitor list:

```sh
node tools/filter-feeds.mjs        # keep the feeds that ship a picture
```

```sh
npm run check                      # Kindle-safe HTML, one ES5 script
```

```
feeds.json                 the paper: sections, feeds, masthead
src/data/news.json         what the board reads
src/data/summaries.json    so a headline is never asked twice
public/img/news/           pictures for this edition
public/kindle/             photographed slides for the plugin
einknews.koplugin/         KOReader app
docs/banner.png            the masthead above
```

---

MIT. See [LICENSE](LICENSE). The news belongs to the feeds it came from.

A house project of **E-INK HACK**. Come share Kindle and e-ink projects
in the [Discord](https://discord.gg/KYChSeuyk).

- GitHub: [kumanaya/eink-news](https://github.com/kumanaya/eink-news)
- X: [danielkumanaya](https://x.com/danielkumanaya)
- Discord: [E-INK HACK](https://discord.gg/KYChSeuyk)
