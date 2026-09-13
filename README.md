# Toolkit

Collection of CLI tools for Schema Labs operations.

## Setup

This project uses [Nix](https://nixos.org/) for dependency management. All commands should be run inside the Nix dev shell:

```bash
nix develop --command <command>
```

First time setup:

```bash
nix develop --command npm install
```

## Tools

### poster-qr

Generate print-ready poster PDFs with unique QR codes and ID labels stamped onto a template image. Each poster gets a unique QR code encoding a URL with UTM tracking parameters, and a subtle ID label in the corner for identifying which physical poster is which.

**Output:** Separate PDFs per paper size (A3, A4), one page per poster, ready for professional print.

#### Preparing the template in Canva

The script needs a PNG template with a magenta placeholder where the QR code should go. Here's how to set it up:

1. **Open your poster design in Canva** (or duplicate an existing one)
2. **Find the QR code element** in the design — if it's an existing poster, it likely already has a QR code on it
3. **Delete the QR code** (or any placeholder image in that spot)
4. **Add a square shape** in its place:
   - Click "Elements" in the left sidebar, search for "Square"
   - Add it and resize it to match the area where the QR was
   - Set the color to exactly **`#FF00FF`** (magenta) — click the color picker, then type `FF00FF` in the hex field
   - Position the square exactly where you want the QR to appear
5. **Export as PNG**:
   - Click "Share" → "Download"
   - File type: **PNG**
   - Size: choose the **largest/max resolution** available (this matters for print quality — the higher the resolution, the sharper the print)
   - Download the file

The magenta square is a marker — the script will detect its position and size automatically, and replace it with unique QR codes.

#### Desktop app

A Tauri-based desktop app provides a step-by-step wizard UI:

1. **Template** — pick your template image and set the marker color
2. **QR Placement** — auto-detects the marker, shows a live preview with a sample QR composited onto the template. Adjust x/y/size and the preview updates in real time.
3. **Settings** — configure URL parameters, batch counts, and ID settings
4. **Generate** — pick output directory, generate or dry-run, with progress bar and log

```bash
nix develop --command npm run app:dev
```

To build a distributable binary:

```bash
nix develop --command npm run app:build
```

#### Running the CLI

```bash
nix develop --command npm run poster-qr -- \
  --template=poster.png \
  --detect \
  --base-url=https://yoursite.com \
  --a3=20 --a4=30
```

This scans the template for the magenta placeholder, replaces it with a unique QR code per poster, adds a subtle ID label in the bottom-left corner, and outputs separate PDFs per paper size (`posters-a3.pdf`, `posters-a4.pdf`). IDs are sequential across all batches — A3 posters get the first IDs, A4 posters continue from there.

#### URL format

Each QR code encodes:

```
{base-url}?utm_source={source}&utm_medium=poster&utm_campaign={campaign}&utm_content={id}
```

- `utm_source` — configurable (default: `qr`)
- `utm_medium` — always `poster`
- `utm_campaign` — optional, only included if provided
- `utm_content` — the sequential poster ID (e.g., `1`, `2`, `03`, `P001`)

#### QR placement

**Auto-detect (recommended):** Add a `#FF00FF` magenta square in your design where the QR should go, then use `--detect`. The script finds it automatically.

**Manual:** Specify pixel coordinates with `--qr-x`, `--qr-y`, `--qr-size`.

#### Continuing a batch

If you've already printed 50 posters and need 30 more:

```bash
nix develop --command npm run poster-qr -- \
  --template=poster.png \
  --detect \
  --base-url=https://yoursite.com \
  --campaign=mycampaign \
  --count=30 \
  --start=51
```

#### All options

| Option | Description | Default |
|--------|-------------|---------|
| `--template` | Path to poster template PNG | required |
| `--base-url` | Base URL for QR codes | required |
| `--campaign` | UTM campaign name | optional |
| `--a3` | Number of A3 posters to generate | - |
| `--a4` | Number of A4 posters to generate | - |
| `--count` | Number of posters (all A4, shorthand for --a4=N) | - |
| `--detect` | Auto-detect QR position from magenta placeholder | - |
| `--source` | UTM source value | `qr` |
| `--start` | First poster ID number | `1` |
| `--prefix` | ID prefix (e.g., `P` for P001) | none |
| `--pad` | Zero-pad IDs to N digits | auto |
| `--marker-color` | Custom marker color hex (without #) | `FF00FF` |
| `--qr-x` | QR left edge X position in px (manual mode) | - |
| `--qr-y` | QR top edge Y position in px (manual mode) | - |
| `--qr-size` | QR code size in px (manual mode) | - |
| `--id-corner` | ID label position: `top-left`, `top-right`, `bottom-left`, `bottom-right` | `bottom-left` |
| `--id-size` | ID label font size in px | `48` |
| `--id-color` | ID label color | `#999999` |
| `--id-offset` | ID label offset from corner in px | `150` |
| `--out-dir` | Output directory | `./qr-output` |
| `--dry-run` | Preview URLs without generating files | - |

#### Interactive mode

Run without flags and the CLI will prompt you for each required value:

```bash
nix develop --command npm run poster-qr
```

### video-edit

Merge, split and trim recordings without desynchronising the audio and video.

Replaces the standalone `video-cutter` app, which passed `-ss` as an output option with
`-c copy` and so produced files whose video and audio start seconds apart. That defect is
invisible until someone watches the result — or, worse, until a transcript is cut from it.

#### Installing

Download `video-edit` from the [latest release](../../releases/latest), then:

```bash
chmod +x video-edit
xattr -c video-edit          # macOS: clears the quarantine flag on a downloaded binary
mv video-edit /usr/local/bin/
```

It is a standalone binary — no Node, npm or Nix needed. ffmpeg is fetched on first run into
a shared cache (`~/Library/Caches/schemalabs-toolkit/bin` on macOS), or skipped entirely if
you already have ffmpeg on your PATH.

Working in this repo instead? `nix develop --command npm run video-edit -- <args>` does the
same thing. The examples below use the installed binary.

#### The three jobs

```bash
# Join three recordings into one
video-edit export \
  --input rec-1.mp4 --input rec-2.mp4 --input rec-3.mp4 --out merged

# Cut an ad break out
video-edit export \
  --input rec.mp4 --remove 1:02:03-1:06:15 --out clean

# Split one recording into two meetings
video-edit export \
  --input rec.mp4 --split 2:30:00 --out part
```

They compose: several `--remove` and `--split` flags can be combined with several `--input`
files in one command. Positions are measured on the joined timeline — what you would see
watching the inputs back to back.

#### Check before you commit to it

`plan` shows what an export will produce without producing it, which matters because a long
recording takes minutes:

```bash
video-edit plan --input rec.mp4 --remove 1:02:03-1:06:15
```

#### Check a file you were given

`inspect` reports whether a recording's audio and video start together. It catches the
offsets that hide behind an MP4 edit list, which `ffprobe` alone reports as healthy:

```bash
video-edit inspect rec.mp4
```

A healthy file ends with `verdict: ok`. Anything else, do not upload it.

#### For agents

Every command takes `--json` and returns structured output, and `plan` exists so an agent can
show you what it is about to do before spending ten minutes on it. Exports are verified
before they are reported as finished, so success is something an agent can confirm rather
than assume.

Cuts are frame-accurate: the interior of each range is copied and only the fraction of a
second at each edge is re-encoded, so a five-hour recording exports in minutes rather than
half an hour. If verification ever fails, the export is redone with a full re-encode and the
result says so — there is no path that produces a bad file and calls it done.
