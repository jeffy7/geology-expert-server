#!/usr/bin/env bash
# ==============================================================================
# 地调院评审专家系统 - 本地一键构建与远程部署脚本
# 使用方式: bash deploy/deploy-local.sh <服务器公网IP> [SSH端口(默认22)] [SSH用户(默认root)]
# 示例: bash deploy/deploy-local.sh 123.45.67.89
# ==============================================================================

set -e

REMOTE_HOST=$1
REMOTE_PORT=${2:-22}
REMOTE_USER=${3:-ubuntu}

if [ -z "$REMOTE_HOST" ]; then
    echo "❌ 错误: 请传入服务器 IP 地址！"
    echo "用法: $0 <IP> [端口] [用户]"
    exit 1
fi

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SERVER_DIR="$PROJECT_ROOT/geology-expert-server"
WEB_DIR="$PROJECT_ROOT/geology-expert-web"
TARGET_DIR="/var/www/geology-expert"

echo ">>> [1/4] 本地构建前端静态产物 (geology-expert-web)..."
cd "$WEB_DIR"
npm run build

echo ">>> [2/4] 本地编译后端代码 (geology-expert-server)..."
cd "$SERVER_DIR"
npm run build

echo ">>> [3/4] 传送文件至云服务器 ($REMOTE_HOST)..."
# 1. 传输前端 dist
rsync -avz -e "ssh -p $REMOTE_PORT" "$WEB_DIR/dist/" "$REMOTE_USER@$REMOTE_HOST:$TARGET_DIR/web/dist/"

# 2. 传输后端编译产物、package.json 与部署配置
ssh -p $REMOTE_PORT "$REMOTE_USER@$REMOTE_HOST" "mkdir -p $TARGET_DIR/server"
rsync -avz -e "ssh -p $REMOTE_PORT" "$SERVER_DIR/dist" "$SERVER_DIR/package.json" "$SERVER_DIR/package-lock.json" "$SERVER_DIR/deploy" "$REMOTE_USER@$REMOTE_HOST:$TARGET_DIR/server/"

echo ">>> [4/4] 远程服务器安装依赖并使用 PM2 重启服务..."
ssh -p $REMOTE_PORT "$REMOTE_USER@$REMOTE_HOST" << 'EOF'
  cd /var/www/geology-expert/server
  npm install --production --silent
  
  # 重载 Nginx
  if [ ! -f /etc/nginx/conf.d/geology-expert.conf ]; then
    sudo cp /var/www/geology-expert/server/deploy/nginx.conf /etc/nginx/conf.d/geology-expert.conf
  fi
  sudo nginx -t && sudo systemctl reload nginx

  # PM2 守护启动或重载
  if pm2 list | grep -q "geology-expert-server"; then
    pm2 reload /var/www/geology-expert/server/deploy/ecosystem.config.js --update-env
  else
    pm2 start /var/www/geology-expert/server/deploy/ecosystem.config.js
    pm2 save
  fi
EOF

echo "✅ 恭喜！部署完成，请访问: http://$REMOTE_HOST"

