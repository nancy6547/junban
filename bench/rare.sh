#!/bin/sh
# Rare-race benchmark: start the demo with RARE=1 first, then run this.
OUT=bench/reruns-rare.json npx tsx bench/reruns.ts 500
rm -rf junban-report
npx tsx src/cli.ts hunt demo/tests/shop.spec.ts > bench/hunt-rare.log 2>&1
cp junban-report/report.json bench/hunt-rare.json
