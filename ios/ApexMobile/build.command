#!/bin/zsh
set -euo pipefail
cd "$(dirname "$0")"

command -v xcodebuild >/dev/null || { echo "Xcode is required"; exit 1; }
command -v cmake >/dev/null || { echo "CMake 3.28+ is required (brew install cmake)"; exit 1; }
command -v xcodegen >/dev/null || { echo "XcodeGen is required (brew install xcodegen)"; exit 1; }

if [[ ! -d llama.cpp ]]; then
  git clone --depth 1 https://github.com/ggml-org/llama.cpp.git llama.cpp
else
  git -C llama.cpp pull --ff-only
fi

rm -rf Frameworks
mkdir -p Frameworks
(
  cd llama.cpp
  ./build-xcframework.sh ios-device
)
cp -R llama.cpp/build-apple/llama.xcframework Frameworks/llama.xcframework
xcodegen generate
open ApexMobile.xcodeproj
