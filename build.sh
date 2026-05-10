#!/bin/bash
set -e
cd artifacts/api-server && npm install && npm run build
cd ../base-sniper && npm install && npm run build
