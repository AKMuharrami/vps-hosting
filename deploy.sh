#!/bin/bash
# Deployment script for VPS

echo "🔄 Pulling latest changes..."
git pull origin main

echo "🏗️ Building and restarting containers..."
docker compose up -d --build

echo "✅ App is live!"
