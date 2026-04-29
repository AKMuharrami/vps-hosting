#!/bin/bash
# SSL Setup Script
# Run this AFTER pointing your domain to the VPS IP

if [ -z "$1" ]; then
    echo "Usage: ./setup_ssl.sh yourdomain.com"
    exit 1
fi

DOMAIN=$1

echo "🔒 Requesting SSL certificate for $DOMAIN..."

# Stop nginx temporarily if needed, or use the --nginx plugin
# Certbot will modify your Nginx config to point to the new certificates
sudo certbot --nginx -d $DOMAIN

echo "🔄 Restarting Nginx..."
sudo systemctl restart nginx

echo "✅ SSL setup complete for $DOMAIN"
