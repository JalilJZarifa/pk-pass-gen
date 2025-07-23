#!/bin/bash
echo "🔄 Updating Arsenal Ticket Bot..."
systemctl stop arsenal-bot
# Update would go here - backup, pull new code, restart
systemctl start arsenal-bot
echo "✅ Bot updated and restarted!"
