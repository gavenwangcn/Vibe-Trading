#!/usr/bin/env bash
# 仅创建/启动微信桥容器（不构建镜像），与已有 docker compose 栈中的 vibe-trading 共用网络。
# 多实例时每个实例使用不同的 --instance 与宿主机数据目录，避免与 compose 内单服务定义冲突。
#
# 前置：已构建镜像，例如：
#   cd Vibe-Trading && docker compose --profile wechat build wechat-bridge
#
# 用法示例（须在 Vibe-Trading 目录执行，或与主栈相同的 compose 项目目录）：
#   ./scripts/wechat-bridge-up.sh --instance a --data-root ./wechat-instances

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

INSTANCE=""
DATA_ROOT="${WECHAT_DATA_ROOT:-./wechat-instances}"
CONTAINER_NAME=""
IMAGE_OVERRIDE=""
FORCE="0"

usage() {
  cat <<'EOF'
仅创建/启动微信桥容器（不构建镜像），加入主栈 vibe-trading 所在网络。
前置: docker compose --profile wechat build wechat-bridge

用法:
  ./scripts/wechat-bridge-up.sh --instance <name> [选项]

参数:
  --instance <name>           必填，实例子目录名；数据目录为 {data-root}/{instance}
  --data-root <path>          可选，WECHAT_DATA_ROOT，默认 ./wechat-instances（相对本目录）
  --container-name <name>     可选，容器名；默认 wechat-bridge-<instance>
  --image <repo:tag>          可选；默认从当前目录 compose 解析 wechat-bridge 镜像 ID
  --force                     同名容器已存在时先删除再创建

前提: 已在同一目录用 docker compose up -d 启动 vibe-trading（与脚本共用默认 compose 项目名）。
环境变量: WECHAT_DATA_ROOT
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --instance)
      INSTANCE="${2:-}"
      shift 2
      ;;
    --data-root)
      DATA_ROOT="${2:-}"
      shift 2
      ;;
    --container-name)
      CONTAINER_NAME="${2:-}"
      shift 2
      ;;
    --image)
      IMAGE_OVERRIDE="${2:-}"
      shift 2
      ;;
    --force)
      FORCE="1"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$INSTANCE" ]]; then
  echo "错误: 必须指定 --instance" >&2
  usage >&2
  exit 1
fi

CT_NAME="${CONTAINER_NAME:-wechat-bridge-${INSTANCE}}"

if [[ "$DATA_ROOT" = /* ]]; then
  DATA_ABS="${DATA_ROOT%/}/${INSTANCE}"
else
  DR="${DATA_ROOT#./}"
  DATA_ABS="${ROOT%/}/${DR%/}/${INSTANCE}"
fi
mkdir -p "$DATA_ABS"
DATA_ABS="$(cd "$DATA_ABS" && pwd)"

API_CID="$(docker compose ps -q vibe-trading 2>/dev/null | head -1 || true)"
if [[ -z "$API_CID" ]]; then
  echo "错误: 未找到运行中的 vibe-trading 容器。" >&2
  echo "请在本目录（Vibe-Trading）先执行: docker compose up -d" >&2
  exit 1
fi

NET="$(docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{println $k}}{{end}}' "$API_CID" | grep -v '^$' | head -1)"
if [[ -z "$NET" ]]; then
  echo "错误: 无法解析 vibe-trading 所在网络。" >&2
  exit 1
fi

if docker inspect "$CT_NAME" >/dev/null 2>&1; then
  if [[ "$FORCE" != "1" ]]; then
    echo "错误: 容器「$CT_NAME」已存在。使用 --force 覆盖，或换 --container-name。" >&2
    exit 1
  fi
  docker rm -f "$CT_NAME" >/dev/null
fi

IMAGE="$IMAGE_OVERRIDE"
if [[ -z "$IMAGE" ]]; then
  IMAGE="$(docker compose --profile wechat images -q wechat-bridge 2>/dev/null | head -1 || true)"
fi
if [[ -z "$IMAGE" ]]; then
  echo "错误: 未找到 wechat-bridge 镜像。请先在本目录构建: docker compose --profile wechat build wechat-bridge" >&2
  echo "或显式传入: --image <镜像名:标签>" >&2
  exit 1
fi

RUN_ENV=()
if [[ -f "$ROOT/.env" ]]; then
  RUN_ENV+=(--env-file "$ROOT/.env")
fi

# 与 docker-compose.yml 中 wechat-bridge 一致；显式 -e 覆盖 .env 中可能指向宿主机的 API 地址
docker run -d \
  --name "$CT_NAME" \
  --network "$NET" \
  "${RUN_ENV[@]}" \
  -e VIBE_TRADING_BASE_URL=http://vibe-trading:8899 \
  -e WECHAT_BRIDGE_STATE_FILE=/data/state.json \
  -e WECHATBOT_STORAGE_DIR=/data/wechatbot \
  -e WECHAT_INSTANCE_NAME="$INSTANCE" \
  -e WECHAT_CONTAINER_NAME="$CT_NAME" \
  -v "$DATA_ABS:/data" \
  --restart unless-stopped \
  -t \
  "$IMAGE"

echo "已启动微信桥容器: $CT_NAME"
echo "  镜像: $IMAGE"
echo "  网络: $NET（与 vibe-trading 相同，API: http://vibe-trading:8899）"
echo "  数据: $DATA_ABS"
