# SSL Certificate Setup

This directory is where you should place your SSL certificates for the Nginx configuration.

## Required Files

Place the following files in this directory:

- `cert.pem` - Your SSL certificate file
- `key.pem` - Your SSL private key file

## File Placement

1. Copy your SSL certificate to: `deployment/nginx/ssl/cert.pem`
2. Copy your SSL private key to: `deployment/nginx/ssl/key.pem`

## File Permissions

Ensure proper permissions are set on your certificate files:

```bash
chmod 644 cert.pem
chmod 600 key.pem
```
