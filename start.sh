#!/bin/bash
export PORT=${PORT:-5000}
node artifacts/api-server/supervisor.js
