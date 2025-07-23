#!/bin/bash
echo "🤖 Arsenal Ticket Bot Status"
echo "============================"
echo "Service Status:"
systemctl status arsenal-bot --no-pager -l
echo ""
echo "Recent Logs:"
journalctl -u arsenal-bot --no-pager -l -n 10
echo ""
echo "Dashboard URL:"
echo "http://$(curl -s ifconfig.me)/admin/6578885683"
echo "http://$(curl -s ifconfig.me)/admin/1055850821"
