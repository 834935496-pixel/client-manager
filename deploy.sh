#!/bin/bash
echo "正在同步文件..."
rsync -av --exclude='.venv' --exclude='*.db' --exclude='__pycache__' \
  ~/Desktop/client-manager/ server:/home/ubuntu/client-manager/

echo "正在重启应用..."
ssh server "sudo systemctl restart client-manager"

echo "部署完成！"
