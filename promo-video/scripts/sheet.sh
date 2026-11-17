#!/bin/sh
# Planches de contrôle d'un tuto : sh scripts/sheet.sh <id> [frames…] → out/tutos-check/sheet-<id>-<frame>.png
id=$1; shift
for fr in ${@:-55 90}; do
  npx remotion still src/index.ts Sheet-$id out/tutos-check/sheet-$id-$fr.png --frame=$fr --scale=0.5 2>&1 | grep -iE "error|Error" -A8
done
exit 0
