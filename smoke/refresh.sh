#!/usr/bin/env bash
# Copy the staged dist/ (from the Mac, via device_stage_files) into the folder the smoke scripts serve.
set -e
rm -rf /home/claude/smoke/dist && mkdir -p /home/claude/smoke/dist
cp -r /mnt/user-data/uploads/Claude/NewHorizons/colony-web/dist/. /home/claude/smoke/dist/
find /home/claude/smoke/dist -type f | sort
