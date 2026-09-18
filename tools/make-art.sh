#!/bin/sh
# Draws the paper's illustrations with ImageMagick and writes them to
# public/img/. The PNGs are committed, so building the site never needs
# ImageMagick; run this only when the art changes.
#
#   sh tools/make-art.sh
#
# Everything comes out grayscale and high contrast, which is what the Kindle's
# e-ink panel shows best. The "living photos" are sprite sheets: all frames side
# by side, animated in CSS with steps() -- no JavaScript, and if the browser
# ignores the animation it simply shows the first frame.

set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/public/img"
TMP="${TMPDIR:-/tmp}/eink-news-art.$$"
mkdir -p "$OUT" "$TMP"
trap 'rm -rf "$TMP"' EXIT INT TERM

MAGICK="${MAGICK:-magick}"
command -v "$MAGICK" >/dev/null 2>&1 || { echo "error: ImageMagick (magick) not found" >&2; exit 1; }

gray() {
    "$MAGICK" "$1" -colorspace Gray -depth 4 -strip "$2"
}

# --- castle: the hero scene, in two frames (stars and mist move) --------------

draw_castle_frame() {
    P="$1"; F="$2"
    "$MAGICK" -size 700x200 xc:white \
        -fill '#d9d9d9' -draw "circle $((596 - P)),$((44 + P / 2)) 596,16" \
        -fill '#cccccc' -draw "circle $((596 - P)),$((44 + P / 2)) 596,20" \
        -fill '#333333' \
        -draw "circle $((90 + P)),30 $((90 + P)),27" \
        -draw "circle 150,$((58 + P)) 150,$((55 + P))" \
        -draw "circle $((250 - P)),24 $((250 - P)),21" \
        -draw "circle 470,$((20 + P)) 470,$((17 + P))" \
        -draw "circle $((640 - P)),66 $((640 - P)),63" \
        -draw "circle 380,$((44 - P)) 380,$((41 - P))" \
        -draw "circle $((520 + P)),$((30 + P)) $((520 + P)),$((28 + P))" \
        -fill '#404040' \
        -draw "polygon 0,200 0,150 90,120 200,158 320,110 460,150 560,124 700,156 700,200" \
        -fill '#1a1a1a' \
        -draw "polygon 300,150 300,86 312,74 324,86 324,150" \
        -draw "polygon 316,74 316,58 336,66 316,74" \
        -draw "polygon 214,150 214,104 226,92 238,104 238,150" \
        -draw "polygon 230,92 230,72 252,82 230,92" \
        -draw "polygon 386,150 386,98 398,84 410,98 410,150" \
        -draw "polygon 398,84 398,62 422,74 398,84" \
        -draw "polygon 262,150 262,118 340,118 340,150" \
        -draw "polygon 358,150 358,118 436,118 436,150" \
        -draw "polygon 250,118 300,98 350,118" \
        -draw "polygon 348,118 398,94 448,118" \
        -draw "polygon 150,150 150,124 178,112 206,124 206,150" \
        -draw "polygon 430,150 430,128 462,114 494,128 494,150" \
        -fill white \
        -draw "rectangle 272,128 280,138" -draw "rectangle 300,128 308,138" \
        -draw "rectangle 326,128 334,138" -draw "rectangle 368,128 376,138" \
        -draw "rectangle 396,128 404,138" -draw "rectangle 420,128 428,138" \
        -draw "circle 316,106 316,102" -draw "circle 398,108 398,104" \
        -draw "circle 226,112 226,109" -draw "circle 178,128 178,126" \
        -draw "circle 462,130 462,128" \
        -fill '#8c8c8c' -stroke '#8c8c8c' -strokewidth 1 \
        -draw "line $((40 + P)),178 $((220 + P)),178" \
        -draw "line $((60 + P)),186 $((260 + P)),186" \
        -draw "line $((30 - P)),192 $((180 - P)),192" \
        -draw "line $((420 - P)),184 $((660 - P)),184" \
        -draw "line $((470 - P)),192 $((640 - P)),192" \
        -stroke none \
        "$F"
    gray "$F" "$F"
}

draw_castle() {
    draw_castle_frame 0 "$TMP/castle0.png"
    draw_castle_frame 12 "$TMP/castle1.png"
    "$MAGICK" "$TMP/castle0.png" "$TMP/castle1.png" +append "$OUT/castle-sprite.png"
}

# --- owl: three wing positions ------------------------------------------------

draw_owl_frame() {
    TIP_X="$1"; TIP_Y="$2"; MID_X="$3"; MID_Y="$4"; F="$5"
    "$MAGICK" -size 160x160 xc:white -fill '#1a1a1a' -stroke '#1a1a1a' \
        -draw "ellipse 80,104 36,46 0,360" \
        -draw "circle 80,58 80,24" \
        -draw "polygon 50,38 62,20 66,46" \
        -draw "polygon 110,38 98,20 94,46" \
        -draw "polygon 66,86 $TIP_X,$TIP_Y $MID_X,$MID_Y 74,118" \
        -draw "polygon 94,86 $((160 - TIP_X)),$TIP_Y $((160 - MID_X)),$MID_Y 86,118" \
        -fill white \
        -draw "circle 66,56 66,47" -draw "circle 94,56 94,47" \
        "$F"
    "$MAGICK" "$F" -fill '#1a1a1a' -draw "circle 67,57 67,52" -draw "circle 93,57 93,52" \
        -draw "polygon 80,62 87,74 73,74" \
        -draw "line 72,150 72,158" -draw "line 88,150 88,158" \
        -stroke none "$F"
    gray "$F" "$F"
}

draw_owl() {
    draw_owl_frame 16 34 30 66 "$TMP/owl0.png"
    draw_owl_frame 12 78 28 92 "$TMP/owl1.png"
    draw_owl_frame 48 132 56 118 "$TMP/owl2.png"
    "$MAGICK" "$TMP/owl0.png" "$TMP/owl1.png" "$TMP/owl2.png" +append "$OUT/owl-sprite.png"
}

# --- snitch: three wing angles ------------------------------------------------

draw_snitch_frame() {
    TX="$1"; TY="$2"; IX="$3"; IY="$4"; F="$5"
    "$MAGICK" -size 90x90 xc:white -fill '#1a1a1a' -stroke '#1a1a1a' -strokewidth 2 \
        -draw "circle 45,52 45,37" \
        -draw "polygon 34,46 $TX,$TY $IX,$IY 38,56" \
        -draw "polygon 56,46 $((90 - TX)),$TY $((90 - IX)),$IY 52,56" \
        -strokewidth 1 \
        -draw "line 32,42 $((TX + 6)),$((TY + 8))" \
        -draw "line 58,42 $((84 - TX)),$((TY + 8))" \
        -stroke none -fill white -draw "circle 40,47 40,44" \
        "$F"
    gray "$F" "$F"
}

draw_snitch() {
    draw_snitch_frame 4 18 16 34 "$TMP/snitch0.png"
    draw_snitch_frame 2 44 12 50 "$TMP/snitch1.png"
    draw_snitch_frame 12 76 20 62 "$TMP/snitch2.png"
    "$MAGICK" "$TMP/snitch0.png" "$TMP/snitch1.png" "$TMP/snitch2.png" +append "$OUT/snitch-sprite.png"
}

# --- crest: the paper's seal --------------------------------------------------

draw_crest() {
    F="$1"
    "$MAGICK" -size 160x160 xc:white -fill none -stroke '#1a1a1a' \
        -strokewidth 5 -draw "circle 80,80 80,6" \
        -strokewidth 2 -draw "circle 80,80 80,16" \
        -stroke none -fill '#1a1a1a' \
        -draw "polygon 62,120 62,74 74,62 86,74 86,120" \
        -draw "polygon 72,62 72,42 96,54 72,62" \
        -draw "polygon 94,120 94,86 106,76 118,86 118,120" \
        -draw "polygon 104,76 104,60 124,70 104,76" \
        -draw "polygon 50,120 50,96 62,86 74,96 74,120" \
        -fill white \
        -draw "rectangle 68,96 80,106" -draw "rectangle 100,98 112,108" \
        -draw "circle 56,100 56,98" \
        -draw "polygon 80,18 82.4,22.8 87.6,23.5 83.8,27.2 84.7,32.5 80,30 75.3,32.5 76.2,27.2 72.4,23.5 77.6,22.8" \
        "$F"
    gray "$F" "$F"
}

# --- ornament: a rule with a diamond, for masthead and section breaks ---------

draw_ornament() {
    F="$1"
    "$MAGICK" -size 600x24 xc:white -fill '#1a1a1a' -stroke '#1a1a1a' -strokewidth 2 \
        -draw "line 0,12 286,12" -draw "line 314,12 600,12" \
        -draw "polygon 300,4 308,12 300,20 292,12" \
        -strokewidth 1 \
        -draw "line 0,18 270,18" -draw "line 330,18 600,18" \
        "$F"
    gray "$F" "$F"
}

draw_castle
draw_owl
draw_snitch
draw_crest "$OUT/crest.png"
draw_ornament "$OUT/ornament.png"

# The browser asks for /favicon.ico on every visit; give it the crest.
"$MAGICK" "$OUT/crest.png" -resize 32x32 "$ROOT/public/favicon.ico"

echo "art written to public/img/:"
ls -1 "$OUT"
