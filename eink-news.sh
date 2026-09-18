#!/bin/sh
# Name: E-INK NEWS
# Author: Daniel Kumanaya
# Description: The day's paper, turning itself on the e-ink panel.
# DontUseFBInk
#
# Install: copy this file to /mnt/us/documents/eink-news.sh
# Cache and log live under /mnt/us/documents/eink-news/
#
# KOReader cannot draw HTML and neither can a scriptlet. The server photographs
# each slide; this loop shows those pictures full screen, one every few seconds,
# the same way the site turns. Tap the screen to go back to the library.

SERVER="${SERVER:-https://eink-news-nine.vercel.app}"
APP_DIR="${APP_DIR:-/mnt/us/documents/eink-news}"
LOG="$APP_DIR/eink-news.log"
FLAG="$APP_DIR/.tapped"
CACHE="$APP_DIR/pages"
EDITION="$APP_DIR/edition.json"
PAGES_FILE="$APP_DIR/pages.txt"
PANEL="${PANEL:-600x800}"
SECONDS_DEFAULT=8

FBINK="${FBINK:-/mnt/us/libkh/bin/fbink}"
[ -x "$FBINK" ] || FBINK="$(command -v fbink 2>/dev/null)"

log() {
    mkdir -p "$APP_DIR" 2>/dev/null
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"
}

say() {
    if [ -z "$FBINK" ]; then
        printf '%s\n' "$1"
        return
    fi
    "$FBINK" -c >/dev/null 2>&1
    printf '%s\n' "$1" | "$FBINK" -y 8 >/dev/null 2>&1
}

fetch() {
    url="$1"
    dest="$2"
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL --max-time 40 -o "$dest" "$url"
        return $?
    fi
    if command -v wget >/dev/null 2>&1; then
        wget -q -T 40 -O "$dest" "$url"
        return $?
    fi
    return 127
}

find_touch_device() {
    D=$(awk '
        $1 == "Section" && $2 == "\"InputDevice\"" { inSec = 1; dev = ""; found = 0 }
        inSec && $2 == "\"Device\"" { dev = $3 }
        inSec && $2 == "\"CorePointer\"" && dev != "" { found = 1 }
        inSec && $1 == "EndSection" {
            if (found && dev != "") { gsub(/"/, "", dev); print dev; exit }
            inSec = 0; dev = ""; found = 0
        }
    ' /etc/xorg.conf 2>/dev/null)
    [ -n "$D" ] && [ -e "$D" ] && { echo "$D"; return; }

    D=$(awk '
        /^N: Name=/ {
            name = $0
            sub(/^N: Name="/, "", name)
            sub(/"$/, "", name)
            ev = ""
        }
        /^H: Handlers=/ {
            for (i = 1; i <= NF; i++) {
                t = $i
                sub(/^Handlers=/, "", t)
                if (t ~ /^event[0-9]+$/) ev = t
            }
        }
        /^B: ABS=/ {
            if (ev != "") {
                if (tolower(name) ~ /(touch|zforce|cyttsp|elan|goodix|ft5|atmel|synaptics|eink|st1232)/) {
                    if (best == "") best = ev
                }
                if (fallback == "") fallback = ev
            }
        }
        END {
            if (best != "") print "/dev/input/" best
            else if (fallback != "") print "/dev/input/" fallback
        }
    ' /proc/bus/input/devices 2>/dev/null)
    [ -n "$D" ] && [ -e "$D" ] && { echo "$D"; return; }

    for D in /dev/input/event1 /dev/input/event0 /dev/input/event2; do
        [ -e "$D" ] && { echo "$D"; return; }
    done
}

# Returns 0 on timeout (turn the page), 1 on a tap (leave).
wait_page() {
    hold="$1"
    DEV=$(find_touch_device)
    rm -f "$FLAG"
    if [ -n "$DEV" ]; then
        dd if="$DEV" bs=16 count=1 >/dev/null 2>&1 && touch "$FLAG" &
        JOB=$!
    else
        JOB=""
    fi
    N=0
    while [ ! -f "$FLAG" ]; do
        sleep 1
        N=$((N + 1))
        if [ "$N" -ge "$hold" ]; then
            [ -n "$JOB" ] && kill "$JOB" 2>/dev/null
            wait "$JOB" 2>/dev/null
            rm -f "$FLAG"
            return 0
        fi
    done
    [ -n "$JOB" ] && kill "$JOB" 2>/dev/null
    wait "$JOB" 2>/dev/null
    rm -f "$FLAG"
    return 1
}

leave() {
    lipc-set-prop com.lab126.powerd preventScreenSaver 0 >/dev/null 2>&1
    [ -n "$FBINK" ] && "$FBINK" -c >/dev/null 2>&1
    lipc-set-prop com.lab126.appmgrd start app://com.lab126.booklet.home >/dev/null 2>&1
}

show_page() {
    png="$1"
    if [ -z "$FBINK" ]; then
        echo "$png"
        return 0
    fi
    "$FBINK" -c >/dev/null 2>&1
    "$FBINK" -g "file=${png}" >/dev/null 2>&1
}

load_edition() {
    mkdir -p "$CACHE"
    if ! fetch "${SERVER}/kindle/edition.json" "$EDITION"; then
        return 1
    fi
    grep -o 'page-[0-9][0-9]*\.png' "$EDITION" | sort | uniq > "$PAGES_FILE"
    HOLD=$(sed -n 's/.*"seconds": *\([0-9][0-9]*\).*/\1/p' "$EDITION" | head -1)
    [ -z "$HOLD" ] && HOLD="$SECONDS_DEFAULT"
    [ "$HOLD" -ge 2 ] 2>/dev/null || HOLD="$SECONDS_DEFAULT"
    GENERATED=$(sed -n 's/.*"generated": *"\([^"]*\)".*/\1/p' "$EDITION" | head -1)
    return 0
}

mkdir -p "$APP_DIR" "$CACHE"
log "start $SERVER"
say "E-INK NEWS
fetching today's edition..."

lipc-set-prop com.lab126.powerd preventScreenSaver 1 >/dev/null 2>&1

if ! load_edition; then
    say "Could not reach the paper.

${SERVER}

Need curl or wget with HTTPS.
Tap to go back."
    log "fetch edition failed"
    wait_page 120
    leave
    exit 1
fi

N=$(wc -l < "$PAGES_FILE" 2>/dev/null)
N=$(echo "$N" | tr -d ' ')
if [ -z "$N" ] || [ "$N" -lt 1 ]; then
    say "The server has no edition yet.
Tap to go back."
    log "no pages in edition.json"
    wait_page 120
    leave
    exit 1
fi

log "edition $GENERATED, $N pages, ${HOLD}s"

I=1
CHECKS=0
while true; do
    PAGE=$(sed -n "${I}p" "$PAGES_FILE")
    DEST="$CACHE/$PAGE"
    if [ ! -f "$DEST" ]; then
        fetch "${SERVER}/kindle/${PANEL}/${PAGE}" "$DEST" || rm -f "$DEST"
    fi
    if [ -f "$DEST" ]; then
        show_page "$DEST"
    else
        say "page ${I}/${N} failed to download"
    fi

    # Prefetch the next one while this page is on screen.
    NEXT=$((I + 1))
    [ "$NEXT" -gt "$N" ] && NEXT=1
    NEXT_PAGE=$(sed -n "${NEXT}p" "$PAGES_FILE")
    NEXT_DEST="$CACHE/$NEXT_PAGE"
    [ -f "$NEXT_DEST" ] || fetch "${SERVER}/kindle/${PANEL}/${NEXT_PAGE}" "$NEXT_DEST" || rm -f "$NEXT_DEST"

    if ! wait_page "$HOLD"; then
        log "tap, leaving"
        leave
        exit 0
    fi

    I=$((I + 1))
    [ "$I" -gt "$N" ] && I=1

    CHECKS=$((CHECKS + 1))
    if [ "$CHECKS" -ge 3 ]; then
        CHECKS=0
        OLD="$GENERATED"
        if load_edition; then
            N=$(wc -l < "$PAGES_FILE" 2>/dev/null)
            N=$(echo "$N" | tr -d ' ')
            if [ -n "$GENERATED" ] && [ "$GENERATED" != "$OLD" ]; then
                log "new edition $GENERATED"
                rm -f "$CACHE"/page-*.png
                I=1
            fi
        fi
    fi
done
