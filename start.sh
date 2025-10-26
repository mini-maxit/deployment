#!/bin/bash

# Maxit Deployment Startup Script
# This script starts the application with Nginx SSL proxy

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SSL_DIR="$SCRIPT_DIR/nginx/ssl"
COMPOSE_DIR="$SCRIPT_DIR/docker-compose"

echo "Starting Maxit application with SSL support..."

# Check if SSL certificates exist
if [ ! -f "$SSL_DIR/cert.pem" ] || [ ! -f "$SSL_DIR/key.pem" ]; then
    echo "ERROR: SSL certificates not found!"
    echo ""
    echo "Please place your SSL certificates in the following location:"
    echo "  Certificate: $SSL_DIR/cert.pem"
    echo "  Private Key: $SSL_DIR/key.pem"
    echo ""
    echo "See $SSL_DIR/README.md for detailed instructions."
    exit 1
fi

# Verify certificate permissions
echo "Checking SSL certificate permissions..."
if [ "$(stat -f %A "$SSL_DIR/key.pem" 2>/dev/null || stat -c %a "$SSL_DIR/key.pem" 2>/dev/null)" != "600" ]; then
    echo "WARNING: Private key permissions are not secure. Setting to 600..."
    chmod 600 "$SSL_DIR/key.pem"
fi

if [ "$(stat -f %A "$SSL_DIR/cert.pem" 2>/dev/null || stat -c %a "$SSL_DIR/cert.pem" 2>/dev/null)" != "644" ]; then
    echo "Setting certificate permissions to 644..."
    chmod 644 "$SSL_DIR/cert.pem"
fi

# Verify certificate validity
echo "Verifying SSL certificate..."
CERT_EXPIRY=$(openssl x509 -enddate -noout -in "$SSL_DIR/cert.pem" | cut -d= -f2)
CERT_SUBJECT=$(openssl x509 -subject -noout -in "$SSL_DIR/cert.pem" | cut -d= -f2-)

echo "Certificate Subject: $CERT_SUBJECT"
echo "Certificate Expires: $CERT_EXPIRY"

# Check if certificate expires within 30 days
EXPIRY_TIMESTAMP=$(date -d "$CERT_EXPIRY" +%s 2>/dev/null || date -j -f "%b %d %H:%M:%S %Y %Z" "$CERT_EXPIRY" +%s 2>/dev/null || echo "0")
CURRENT_TIMESTAMP=$(date +%s)
THIRTY_DAYS=$((30 * 24 * 60 * 60))

if [ "$EXPIRY_TIMESTAMP" -gt 0 ] && [ $((EXPIRY_TIMESTAMP - CURRENT_TIMESTAMP)) -lt $THIRTY_DAYS ]; then
    echo "WARNING: SSL certificate expires within 30 days!"
fi

# Create volumes directories if they don't exist
echo "Creating volume directories..."
mkdir -p "$SCRIPT_DIR/volumes/file-storage-media"
mkdir -p "$SCRIPT_DIR/volumes/pgdata"

# Start the application
echo "Starting Docker Compose services..."
cd "$COMPOSE_DIR"

# Pull latest images
echo "Pulling latest Docker images..."
docker-compose pull

# Start services
echo "Starting all services..."
docker-compose up -d

# Wait for services to be ready
echo "Waiting for services to start..."
sleep 10

# Check service health
echo "Checking service status..."
docker-compose ps

echo ""
echo "🚀 Maxit application started successfully!"
echo ""
