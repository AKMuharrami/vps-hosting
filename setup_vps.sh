#!/bin/bash
# VPS Setup Script for Hostinger (Ubuntu)
# This script installs Docker, Docker Compose, Nginx, and essential tools.

set -e

echo "🚀 Starting VPS Setup..."

# Update system
sudo apt-get update && sudo apt-get upgrade -y

# Install essential tools
sudo apt-get install -y curl git wget build-essential software-properties-common

# Install Docker
echo "📦 Installing Docker..."
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Nginx
echo "🌐 Installing Nginx..."
sudo apt-get install -y nginx

# Install Certbot (for SSL)
echo "🔒 Installing Certbot..."
sudo apt-get install -y certbot python3-certbot-nginx

echo "✅ System tools installed!"
echo "⚠️ Please LOG OUT and LOG BACK IN to enable Docker permissions for your user."
