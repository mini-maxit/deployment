#!/bin/bash

# List of repository URLs
REPOS=(
    "https://github.com/mini-maxit/backend.git"
    "https://github.com/mini-maxit/worker.git"
    "https://github.com/mini-maxit/file-storage.git"
    "https://github.com/mini-maxit/frontend.git"
)

# Directory to clone repositories into
CLONE_DIR="./repositories"

# Create the directory if it doesn't exist
mkdir -p "$CLONE_DIR"

# Clone each repository
for REPO in "${REPOS[@]}"; do
    git clone "$REPO" "$CLONE_DIR/$(basename "$REPO" .git)"
done

# Run Docker Compose command
docker compose up -d --build
