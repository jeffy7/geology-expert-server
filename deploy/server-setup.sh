#!/usr/bin/env bash
# ==============================================================================
# 地调院评审专家系统 - 云服务器(Ubuntu/Debian) 一键基础环境初始化脚本
# ==============================================================================

set -e

echo ">>> [1/6] 更新软件包索引并安装基础工具..."
sudo apt-get update -y
sudo apt-get install -y curl wget git vim ufw unzip

echo ">>> [2/6] 安装 Node.js 20.x 与 PM2..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi
sudo npm install -g pm2

echo ">>> [3/6] 安装 Nginx 反向代理服务..."
sudo apt-get install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx

echo ">>> [4/6] 安装 MySQL 8.0 服务..."
sudo apt-get install -y mysql-server
sudo systemctl enable mysql
sudo systemctl start mysql

echo ">>> [5/6] 创建部署工作目录..."
sudo mkdir -p /var/www/geology-expert/web
sudo mkdir -p /var/www/geology-expert/server
sudo chown -R $USER:$USER /var/www/geology-expert

echo ">>> [6/6] 基础环境搭建完成！"
echo "Node 版本: $(node -v)"
echo "NPM 版本: $(npm -v)"
echo "MySQL 状态: $(sudo systemctl is-active mysql)"
echo "Nginx 状态: $(sudo systemctl is-active nginx)"
echo "=============================================================================="
echo "下一步操作提示："
echo "1. 执行 sudo mysql 登录数据库，创建数据库和用户："
echo "   CREATE DATABASE geology_expert_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
echo "   CREATE USER 'geology_user'@'localhost' IDENTIFIED BY 'YourStrongPassword123';"
echo "   GRANT ALL PRIVILEGES ON geology_expert_db.* TO 'geology_user'@'localhost';"
echo "   FLUSH PRIVILEGES;"
echo "2. 将 init_schema_seed.sql 导入到 geology_expert_db。"
echo "=============================================================================="

