#!/bin/bash

pkill -f expo || true
pkill -f node || true

rm -rf .expo

export EXPO_NO_DEVTOOLS=1
export CI=1
export REACT_NATIVE_MAX_WORKERS=1
export EXPO_NO_DOTENV=1

npx expo start --tunnel --clear
