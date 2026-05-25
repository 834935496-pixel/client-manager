#!/bin/bash
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "⚠️  请先编辑 .env 文件填写 DEEPSEEK_API_KEY 和 ACCESS_PASSWORD"
  open .env
  exit 1
fi

if [ ! -d .venv ]; then
  echo "📦 创建虚拟环境..."
  python3 -m venv .venv
fi

source .venv/bin/activate
pip install -q -r requirements.txt

echo "🚀 启动客户档案系统 → http://localhost:8000"
python main.py
