#!/bin/bash

echo "Pulling latest code..."
git pull

echo "Restarting bot..."
pm2 restart mcgbot

echo "Done."
