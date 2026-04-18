#!/usr/bin/env bash
# 构建 wechat-bridge 镜像前检查：本仓库内须有 wechatbot/nodejs/（与 Dockerfile COPY 一致）。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK="$ROOT/wechatbot/nodejs/package.json"
if [[ ! -f "$SDK" ]]; then
  echo "错误: 未找到: $ROOT/wechatbot/nodejs/package.json" >&2
  echo "  微信 SDK 应位于 Vibe-Trading/wechatbot/nodejs/。" >&2
  exit 1
fi
echo "OK: $ROOT/wechatbot/nodejs"
