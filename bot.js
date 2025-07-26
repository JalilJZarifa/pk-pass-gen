// Enhanced API endpoint for dashboard stats with credits system
app.get('/api/stats/:adminId', (req, res) => {
    const adminId = parseInt(req.params.adminId);
    
    if (!config.ADMIN_IDS.includes(adminId)) {
        return res.status(403).json({ error: 'Access denied' });
    }
    
    // Get comprehensive client data with credits
    db.all(`
        SELECT 
            u.username, u.first_name, u.is_active, u.credits, u.infinite_credits,
            u.total_passes_created, u.created_at, u.last_used,
            COUNT(s.id) as scan_count
        FROM users u 
        LEFT JOIN scans s ON u.user_id = s.user_id 
        WHERE u.admin_id = ? AND u.user_id != 0
        GROUP BY u.user_id
        ORDER BY u.last_used DESC
    `, [adminId], (err, clients) => {
        
        // Get overall statistics
        db.get(`
            SELECT 
                COUNT(DISTINCT CASE WHEN u.is_active = 1 THEN u.user_id END) as active_clients,
                COUNT(DISTINCT u.user_id) as total_clients,
                COUNT(DISTINCT CASE WHEN u.infinite_credits = 1 THEN u.user_id END) as unlimited_users,
                SUM(u.credits) as total_credits_distributed,
                SUM(u.total_passes_created) as total_passes_created,
                COUNT(s.id) as total_scans,
                COUNT(CASE WHEN s.created_at >= date('now') THEN 1 END) as scans_today,
                COUNT(CASE WHEN s.created_at >= date('now', '-7 days') THEN 1 END) as scans_this_week,
                COUNT(CASE WHEN s.pass_generated = 1 THEN 1 END) as passes_generated
            FROM users u
            LEFT JOIN scans s ON u.user_id = s.user_id 
            WHERE u.admin_id = ? AND u.user_id != 0
        `, [adminId], (err, stats) => {
            
            // Get recent scans with pass generation info
            db.all(`
                SELECT 
                    s.created_at, s.scan_data, s.pass_generated, s.credits_used,
                    u.first_name
                FROM scans s
                JOIN users u ON s.user_id = u.user_id
                WHERE s.admin_id = ?
                ORDER BY s.created_at DESC
                LIMIT 15
            `, [adminId], (err, recentScans) => {
                
                // Get recent credit transactions
                db.all(`
                    SELECT 
                        ct.created_at, ct.transaction_type, ct.amount, 
                        ct.balance_before, ct.balance_after, ct.infinite_before, ct.infinite_after,
                        ct.description, u.first_name
                    FROM credit_transactions ct
                    JOIN users u ON ct.user_id = u.user_id
                    WHERE u.admin_id = ?
                    ORDER BY ct.created_at DESC
                    LIMIT 15
                `, [adminId], (err, creditTransactions) => {
                    
                    const formatDate = (dateStr) => {
                        if (!dateStr) return 'Never';
                        return new Date(dateStr).toLocaleDateString('en-GB');
                    };
                    
                    const formatTime = (dateStr) => {
                        if (!dateStr) return '';
                        return new Date(dateStr).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                    };
                    
                    res.json({
                        totalClients: stats.total_clients || 0,
                        activeClients: stats.active_clients || 0,
                        unlimitedUsers: stats.unlimited_users || 0,
                        totalCreditsDistributed: stats.total_credits_distributed || 0,
                        totalPasses: stats.total_passes_created || 0,
                        totalScans: stats.total_scans || 0,
                        scansToday: stats.scans_today || 0,
                        scansThisWeek: stats.scans_this_week || 0,
                        passesGenerated: stats.passes_generated || 0,
                        
                        clients: clients.map(c => {
                            let creditsClass = 'normal';
                            let creditsDisplay = '';
                            
                            if (c.infinite_credits) {
                                creditsClass = 'unlimited';
                                creditsDisplay = 'Unlimited 💎';
                            } else if (c.credits === 0) {
                                creditsClass = 'low';
                                creditsDisplay = '0 credits';
                            } else if (c.credits < 3) {
                                creditsClass = 'low';
                                creditsDisplay = `${c.credits} credits`;
                            } else {
                                creditsClass = 'normal';
                                creditsDisplay = `${c.credits} credits`;
                            }
                            
                            return {
                                name: c.first_name,
                                username: c.username,
                                active: c.is_active === 1,
                                credits: creditsDisplay,
                                creditsClass: creditsClass,
                                passesCreated: c.total_passes_created || 0,
                                scans: c.scan_count || 0,
                                lastUsed: formatDate(c.last_used),
                                registered: formatDate(c.created_at)
                            };
                        }),
                        
                        recentScans: recentScans.map(s => {
                            let matchData = 'Unknown match';
                            let barcodeStatus = '❌ No barcode';
                            
                            try {
                                const data = JSON.parse(s.scan_data);
                                matchData = data.game || 'Unknown match';
                                
                                if (data.barcode && data.barcode !== 'Not detected') {
                                    barcodeStatus = '✅ Detected';
                                }
                            } catch (e) {}
                            
                            return {
                                date: formatDate(s.created_at),
                                time: formatTime(s.created_at),
                                client: s.first_name,
                                match: matchData,
                                barcodeStatus: barcodeStatus,
                                passGenerated: s.pass_generated ? '✅ Yes' : '❌ No',
                                creditsUsed: s.credits_used || 0
                            };
                        }),
                        
                        creditTransactions: creditTransactions.map(tx => {
                            const beforeText = tx.infinite_before ? 'Unlimited' : tx.balance_before;
                            const afterText = tx.infinite_after ? 'Unlimited' : tx.balance_after;
                            
                            return {
                                date: formatDate(tx.created_at),
                                time: formatTime(tx.created_at),
                                client: tx.first_name,
                                description: tx.description,
                                amount: tx.amount || 0,
                                before: beforeText,
                                after: afterText
                            };
                        })
                    });
                });
            });
        });
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        admins: config.ADMIN_IDS.length,
        version: '6.0.0-credits',
        features: [
            'professional_barcode_scanning',
            'apple_wallet_generation',
            'credit_based_system',
            'ai_powered_extraction',
            'digital_ticket_creation',
            'enhanced_admin_dashboard',
            'comprehensive_credit_management',
            'transaction_tracking',
            'unlimited_credits_option'
        ]
    });
});

// Initialize and start
initializeDatabase();

app.listen(config.PORT, () => {
    console.log(`🌐 Enhanced admin dashboard with credits system running on port ${config.PORT}`);
    console.log('📊 Dashboard URLs:');
    config.ADMIN_IDS.forEach(id => {
        console.log(`   Admin ${id}: http://localhost:${config.PORT}/admin/${id}`);
    });
});

console.log('🚀 Arsenal Ticket Bot is now running with Credits System & Apple Wallet support!');
console.log('🤖 Bot username: @Arsenal_PK_bot');
console.log('👥 Configured admins:', config.ADMIN_IDS);
console.log('🔍 Enhanced features: Professional scanning + Apple Wallet generation + Credits System');
console.log('📱 Users can now get digital tickets for their iPhone!');
console.log('💳 Credit-based system with comprehensive management tools');
console.log('📊 Real-time credit tracking and transaction history');// Handle callback queries (button presses) with credits system
bot.on('callback_query', async (query) => {
    const userId = query.from.id;
    const data = query.data;
    const firstName = query.from.first_name || 'User';
    
    console.log(`🔘 Button pressed: ${data} by ${firstName} (${userId})`);
    
    if (data === 'confirm') {
        // Check credits before generating pass (except for admins)
        if (!isAdmin(userId)) {
            const userCredits = await getUserCredits(userId);
            if (!userCredits.infinite && userCredits.credits <= 0) {
                bot.answerCallbackQuery(query.id, { text: '❌ No credits available!' });
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                    chat_id: userId,
                    message_id: query.message.message_id
                });
                bot.sendMessage(userId, '💳 *No Credits Available*\n\nYou have no credits left to create passes.\n\nContact your administrator to add more credits to your account.', { parse_mode: 'Markdown' });
                return;
            }
        }
        
        bot.answerCallbackQuery(query.id, { text: '✅ Generating pass...' });
        bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
            chat_id: userId,
            message_id: query.message.message_id
        });
        
        // Generate Apple Wallet pass
        const ticketData = global.pendingEdits && global.pendingEdits[userId];
        if (ticketData) {
            const walletMsg = await bot.sendMessage(userId, '🎫 *Generating Apple Wallet Pass...*\n\nPlease wait while I create your digital ticket...', { parse_mode: 'Markdown' });
            
            try {
                const passResult = await generateWalletPass(ticketData, userId);
                
                // Use credit if not admin
                let creditUsed = false;
                const adminId = await getAdminForUser(userId) || (isAdmin(userId) ? userId : null);
                
                if (!isAdmin(userId) && adminId) {
                    creditUsed = await useCredit(userId, adminId, 'Apple Wallet pass generation');
                    if (!creditUsed) {
                        await bot.editMessageText('❌ *Credit Error*\n\nFailed to process credit for pass generation. Please contact your administrator.', {
                            chat_id: userId,
                            message_id: walletMsg.message_id,
                            parse_mode: 'Markdown'
                        });
                        return;
                    }
                }
                
                // Send the .pkpass file
                await bot.sendDocument(userId, passResult.path, {
                    caption: '📱 *Your Apple Wallet Pass is Ready!*',
                    parse_mode: 'Markdown'
                });
                
                // Update scan record with pass generation info
                if (adminId) {
                    db.run("UPDATE scans SET pass_generated = 1, pass_filename = ?, credits_used = ? WHERE user_id = ? AND admin_id = ? ORDER BY created_at DESC LIMIT 1", 
                           [passResult.filename, creditUsed ? 1 : 0, userId, adminId]);
                }
                
                // Show updated credits for non-admin users
                let successMessage = '✅ *Apple Wallet Pass Generated!*\n\nYour digital ticket has been created and sent above.';
                
                if (!isAdmin(userId)) {
                    const userCredits = await getUserCredits(userId);
                    const creditsText = userCredits.infinite ? 
                        'Unlimited 💎' : 
                        `${userCredits.credits} credits remaining`;
                    successMessage += `\n\n💳 *Credits:* ${creditsText}`;
                }
                
                await bot.editMessageText(successMessage, {
                    chat_id: userId,
                    message_id: walletMsg.message_id,
                    parse_mode: 'Markdown'
                });
                
                // Clean up the file after sending
                setTimeout(() => {
                    try {
                        fs.unlinkSync(passResult.path);
                        console.log('🗑️ Cleaned up .pkpass file');
                    } catch (e) {
                        console.log('⚠️ Could not delete .pkpass file:', e.message);
                    }
                }, 30000); // Delete after 30 seconds
                
                // Clean up pending edits
                if (global.pendingEdits && global.pendingEdits[userId]) {
                    delete global.pendingEdits[userId];
                }
                
                // Notify admin about pass generation
                if (!isAdmin(userId) && adminId && creditUsed) {
                    const userCredits = await getUserCredits(userId);
                    const creditsText = userCredits.infinite ? 
                        'Unlimited 💎' : 
                        `${userCredits.credits} credits`;
                    
                    bot.sendMessage(adminId, `📱 *Pass Generated*\n\n${firstName} created a wallet pass.\n\n💳 Remaining credits: ${creditsText}`, { parse_mode: 'Markdown' });
                }
                
            } catch (error) {
                console.error('❌ Error generating wallet pass:', error);
                await bot.editMessageText('❌ *Wallet Pass Generation Failed*\n\nSorry, there was an error creating your Apple Wallet pass. The ticket information is still available above.\n\nPlease contact an administrator if this continues to happen.', {
                    chat_id: userId,
                    message_id: walletMsg.message_id,
                    parse_mode: 'Markdown'
                });
            }
        } else {
            bot.sendMessage(userId, '❌ *No ticket data found*\n\nPlease scan a new ticket image.', { parse_mode: 'Markdown' });
        }
        
    } else if (data === 'edit') {
        bot.answerCallbackQuery(query.id, { text: 'Edit request noted' });
        bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
            chat_id: userId,
            message_id: query.message.message_id
        });
        
        const editMessage = '✏️ *Edit Request Received*\n\n' +
                           'Please describe what information needs to be corrected and I\'ll help you.\n\n' +
                           '*What would you like to change?*\n' +
                           '• Match details\n' +
                           '• Date/time\n' +
                           '• Seat information\n' +
                           '• Barcode data\n' +
                           '• Other details\n\n' +
                           'Just tell me what needs fixing!';
        
        bot.sendMessage(userId, editMessage, { parse_mode: 'Markdown' });
    }
});

// Handle text messages (for edit requests and help)
bot.on('message', (msg) => {
    if (msg.text && !msg.text.startsWith('/') && !msg.photo) {
        const userId = msg.from.id;
        const firstName = msg.from.first_name || 'User';
        
        logMessage(userId, msg.text, 'text');
        
        if (msg.text.toLowerCase().includes('help') || msg.text.includes('?')) {
            let helpMessage = '❓ *Need Help?*\n\n' +
                               '*For ticket scanning:*\n' +
                               '📸 Just send me a clear image of your Arsenal ticket\n\n' +
                               '*For best results:*\n' +
                               '• Make sure the image is clear and well-lit\n' +
                               '• Ensure all text on the ticket is visible\n' +
                               '• Make sure barcodes/QR codes are clearly visible\n' +
                               '• Avoid shadows, reflections, or blur\n\n' +
                               '*What you\'ll get:*\n' +
                               '📊 Complete ticket information extraction\n' +
                               '🔍 Professional barcode scanning\n' +
                               '📱 Apple Wallet pass generation\n\n';
            
            if (!isAdmin(userId)) {
                helpMessage += '*Credits System:*\n' +
                              '💳 Each pass generation uses 1 credit\n' +
                              '🔍 Use `/credits` to check your balance\n' +
                              '👨‍💼 Contact your administrator for more credits\n\n';
            }
            
            helpMessage += '*Contact:* If you continue having problems, contact your administrator.';
            
            bot.sendMessage(userId, helpMessage, { parse_mode: 'Markdown' });
        }
    }
});

// Simplified format function
function formatTicketInfo(data) {
    const formatField = (label, value, emoji) => {
        const displayValue = (value && value !== "Not detected" && value !== "null") ? value : "Not detected";
        return `${emoji} **${label}:** ${displayValue}`;
    };

    let response = `🎫 *Ticket Information Extracted*\n\n` +
           `${formatField('Match', data.game, '⚽')}\n` +
           `${formatField('Date & Time', data.datetime, '📅')}\n` +
           `${formatField('Area/Section', data.area, '🏟️')}\n` +
           `${formatField('Row', data.row, '📍')}\n` +
           `${formatField('Seat', data.seat, '💺')}\n` +
           `${formatField('Ticket Type', data.ticketType, '🎟️')}\n` +
           `${formatField('Membership', data.membership, '🆔')}\n` +
           `${formatField('Enter Via', data.enterVia, '🚪')}\n`;

    // Simple barcode display (shows original, cleaned version will be used in pass)
    if (data.barcode && data.barcode !== "Not detected") {
        response += `\n📊 **Barcode:** \`${data.barcode}\`\n`;
        
        // Show cleaned version if different
        const cleaned = cleanBarcodeForPass(data.barcode);
        if (cleaned !== data.barcode) {
            response += `📊 **Pass Barcode:** \`${cleaned}\`\n`;
        }
    } else {
        response += `\n📊 **Barcode:** Not detected\n`;
    }

    response += `\n*Ready to generate your wallet pass?*`;
    return response;
}

// Error handling
bot.on('polling_error', (error) => {
    console.error('❌ Polling error:', error);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught exception:', error);
});

process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled rejection:', error);
});

// Admin dashboard setup
app.use(express.static('public'));
app.use(express.json());

// Enhanced admin dashboard route with credits system
app.get('/admin/:adminId', (req, res) => {
    const adminId = parseInt(req.params.adminId);
    if (!config.ADMIN_IDS.includes(adminId)) {
        return res.status(403).send('<h1>Access Denied</h1><p>Invalid admin ID.</p>');
    }
    
    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Arsenal Ticket Bot - Enhanced Dashboard with Credits</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; background: #f5f7fa; }
            .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); color: white; padding: 30px; border-radius: 15px; margin-bottom: 30px; text-align: center; }
            .header h1 { font-size: 2.5rem; margin-bottom: 10px; }
            .header p { opacity: 0.9; font-size: 1.1rem; }
            .enhanced-badge { background: #059669; color: white; padding: 4px 12px; border-radius: 20px; font-size: 0.8rem; margin-left: 10px; }
            .credits-badge { background: #7c3aed; color: white; padding: 4px 12px; border-radius: 20px; font-size: 0.8rem; margin-left: 10px; }
            .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
            .stat-card { background: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); text-align: center; border-left: 4px solid #dc2626; }
            .stat-card.credits { border-left-color: #7c3aed; }
            .stat-card.usage { border-left-color: #059669; }
            .stat-number { font-size: 2.2em; font-weight: bold; color: #dc2626; margin-bottom: 5px; }
            .stat-number.credits { color: #7c3aed; }
            .stat-number.usage { color: #059669; }
            .stat-label { color: #6b7280; font-weight: 500; font-size: 0.9rem; }
            .section { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); margin-bottom: 30px; }
            .section h2 { color: #1f2937; margin-bottom: 20px; font-size: 1.5rem; }
            table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
            th, td { padding: 12px 8px; text-align: left; border-bottom: 1px solid #e5e7eb; }
            th { background: #f9fafb; font-weight: 600; color: #374151; }
            .status-active { color: #059669; font-weight: bold; }
            .status-inactive { color: #dc2626; font-weight: bold; }
            .credits-unlimited { color: #7c3aed; font-weight: bold; }
            .credits-low { color: #dc2626; font-weight: bold; }
            .credits-normal { color: #059669; font-weight: bold; }
            .barcode-success { color: #059669; font-weight: bold; }
            .barcode-failed { color: #dc2626; font-weight: bold; }
            .refresh-btn { background: #dc2626; color: white; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; float: right; margin-bottom: 20px; }
            .refresh-btn:hover { background: #991b1b; }
            .loading { text-align: center; padding: 40px; color: #6b7280; }
            .feature-list { background: #f0f9ff; padding: 20px; border-radius: 10px; margin-bottom: 20px; }
            .feature-list h3 { color: #0369a1; margin-bottom: 15px; }
            .feature-list ul { list-style: none; padding: 0; }
            .feature-list li { padding: 5px 0; color: #0c4a6e; }
            .feature-list li:before { content: "✨ "; color: #059669; }
            .credits-info { background: #fef3c7; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #f59e0b; }
            .credits-info h4 { color: #92400e; margin-bottom: 10px; }
            .credits-commands { background: #f3e8ff; padding: 15px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #7c3aed; }
            .credits-commands h4 { color: #5b21b6; margin-bottom: 10px; }
            .credits-commands code { background: #e9d5ff; padding: 2px 6px; border-radius: 4px; font-size: 0.85rem; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🎫 Arsenal Ticket Bot <span class="enhanced-badge">WALLET</span><span class="credits-badge">CREDITS</span></h1>
                <p>Enhanced Admin Dashboard with Credits System - ID: ${adminId}</p>
                <small>Now with comprehensive credit management and Apple Wallet pass generation</small>
            </div>
            
            <div class="feature-list">
                <h3>🆕 Enhanced Features</h3>
                <ul>
                    <li>Professional barcode scanning with Cloudmersive API</li>
                    <li>Apple Wallet pass generation for iPhone users</li>
                    <li>Credit-based system with unlimited options</li>
                    <li>Comprehensive user and credit management</li>
                    <li>Detailed transaction tracking and analytics</li>
                    <li>Real-time credit monitoring and notifications</li>
                </ul>
            </div>
            
            <div class="credits-info">
                <h4>💳 Credits System</h4>
                <p><strong>How it works:</strong> Each pass generation costs 1 credit. Admins have unlimited credits. You can give users specific amounts or unlimited credits.</p>
            </div>
            
            <div class="credits-commands">
                <h4>🛠️ Quick Commands</h4>
                <p>
                    <code>/addcredits @username 5</code> - Add 5 credits<br>
                    <code>/infinite @username</code> - Toggle unlimited credits<br>
                    <code>/credits @username</code> - Check user credits<br>
                    <code>/transactions @username</code> - View credit history
                </p>
            </div>
            
            <button class="refresh-btn" onclick="loadDashboard()">🔄 Refresh Data</button>
            <div class="clearfix" style="clear: both;"></div>
            
            <div id="dashboard" class="loading">
                <h3>Loading enhanced dashboard with credits data...</h3>
            </div>
        </div>
        
        <script>
            function loadDashboard() {
                document.getElementById('dashboard').innerHTML = '<div class="loading"><h3>Loading enhanced dashboard with credits data...</h3></div>';
                
                fetch('/api/stats/${adminId}')
                    .then(response => response.json())
                    .then(data => {
                        document.getElementById('dashboard').innerHTML = \`
                            <div class="stats-grid">
                                <div class="stat-card">
                                    <div class="stat-number">\${data.totalClients}</div>
                                    <div class="stat-label">Total Clients</div>
                                </div>
                                <div class="stat-card">
                                    <div class="stat-number">\${data.activeClients}</div>
                                    <div class="stat-label">Active Clients</div>
                                </div>
                                <div class="stat-card credits">
                                    <div class="stat-number credits">\${data.unlimitedUsers}</div>
                                    <div class="stat-label">Unlimited Credits</div>
                                </div>
                                <div class="stat-card credits">
                                    <div class="stat-number credits">\${data.totalCreditsDistributed}</div>
                                    <div class="stat-label">Credits Distributed</div>
                                </div>
                                <div class="stat-card usage">
                                    <div class="stat-number usage">\${data.totalPasses}</div>
                                    <div class="stat-label">Passes Created</div>
                                </div>
                                <div class="stat-card">
                                    <div class="stat-number">\${data.totalScans}</div>
                                    <div class="stat-label">Total Scans</div>
                                </div>
                                <div class="stat-card">
                                    <div class="stat-number">\${data.scansToday}</div>
                                    <div class="stat-label">Scans Today</div>
                                </div>
                                <div class="stat-card">
                                    <div class="stat-number">\${data.scansThisWeek}</div>
                                    <div class="stat-label">This Week</div>
                                </div>
                            </div>
                            
                            <div class="section">
                                <h2>👥 Client Management & Credits</h2>
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Client</th>
                                            <th>Username</th>
                                            <th>Status</th>
                                            <th>Credits</th>
                                            <th>Passes Created</th>
                                            <th>Total Scans</th>
                                            <th>Last Used</th>
                                            <th>Registered</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        \${data.clients.map(client => \`
                                            <tr>
                                                <td>\${client.name}</td>
                                                <td>@\${client.username}</td>
                                                <td><span class="status-\${client.active ? 'active' : 'inactive'}">\${client.active ? 'Active' : 'Inactive'}</span></td>
                                                <td><span class="credits-\${client.creditsClass}">\${client.credits}</span></td>
                                                <td>\${client.passesCreated}</td>
                                                <td>\${client.scans}</td>
                                                <td>\${client.lastUsed}</td>
                                                <td>\${client.registered}</td>
                                            </tr>
                                        \`).join('')}
                                    </tbody>
                                </table>
                                \${data.clients.length === 0 ? '<p style="text-align: center; color: #6b7280; padding: 20px;">No clients found. Use /adduser @username in the bot to add clients.</p>' : ''}
                            </div>
                            
                            <div class="section">
                                <h2>📊 Recent Activity</h2>
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Date</th>
                                            <th>Client</th>
                                            <th>Match</th>
                                            <th>Barcode Status</th>
                                            <th>Pass Generated</th>
                                            <th>Credits Used</th>
                                            <th>Time</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        \${data.recentScans.map(scan => \`
                                            <tr>
                                                <td>\${scan.date}</td>
                                                <td>\${scan.client}</td>
                                                <td>\${scan.match}</td>
                                                <td><span class="barcode-\${scan.barcodeStatus.includes('✅') ? 'success' : 'failed'}">\${scan.barcodeStatus}</span></td>
                                                <td>\${scan.passGenerated}</td>
                                                <td>\${scan.creditsUsed}</td>
                                                <td>\${scan.time}</td>
                                            </tr>
                                        \`).join('')}
                                    </tbody>
                                </table>
                                \${data.recentScans.length === 0 ? '<p style="text-align: center; color: #6b7280; padding: 20px;">No recent activity found.</p>' : ''}
                            </div>
                            
                            <div class="section">
                                <h2>💳 Credit Transactions (Last 15)</h2>
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Date</th>
                                            <th>Client</th>
                                            <th>Transaction</th>
                                            <th>Amount</th>
                                            <th>Before</th>
                                            <th>After</th>
                                            <th>Time</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        \${data.creditTransactions.map(tx => \`
                                            <tr>
                                                <td>\${tx.date}</td>
                                                <td>\${tx.client}</td>
                                                <td>\${tx.description}</td>
                                                <td>\${tx.amount}</td>
                                                <td>\${tx.before}</td>
                                                <td>\${tx.after}</td>
                                                <td>\${tx.time}</td>
                                            </tr>
                                        \`).join('')}
                                    </tbody>
                                </table>
                                \${data.creditTransactions.length === 0 ? '<p style="text-align: center; color: #6b7280; padding: 20px;">No credit transactions found.</p>' : ''}
                            </div>
                        \`;
                    })
                    .catch(error => {
                        document.getElementById('dashboard').innerHTML = '<div class="loading"><h3 style="color: #dc2626;">Error loading data. Please refresh the page.</h3></div>';
                        console.error('Error:', error);
                    });
            }
            
            loadDashboard();
            setInterval(loadDashboard, 30000);
        </script>
    </body>
    </html>
    `);
});const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const crypto = require('crypto');
const { execSync } = require('child_process');
const archiver = require('archiver');

// Configuration
const config = {
    TELEGRAM_BOT_TOKEN: '7813821568:AAELIYjOOSVsazrNzzOxfypYcanNS7wkUIo',
    GEMINI_API_KEY: 'AIzaSyCDFX8Md3kOfMxSZ0zcjTMRb7HhhQwPKi4',
    CLOUDMERSIVE_API_KEY: 'd3015523-25a1-4239-bc0d-a486fdcd3f86',
    ADMIN_IDS: [6578885683, 1055850821],
    PORT: 3000,
    DATABASE_PATH: './bot_data.db',
    // Apple Wallet Pass Config
    PASS_TYPE_ID: "pass.com.ramzi.tickets",
    TEAM_ID: "8T5HUCJT5Z", 
    ORG_NAME: "Arsenal FC",
    CERTIFICATE_PATH: "certificate.p12",
    CERT_PASSWORD: "Wallet123",
    PEM_CERT_PATH: "certificate.pem",
    PEM_KEY_PATH: "privatekey_nopass.pem",
    WWDR_CERT_PATH: "AppleWWDRCAG4.pem",
    OUTPUT_DIR: "passes",
    TEMPLATE_DIR: "pass_template"
};

// Initialize bot and database
const bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: true });
const app = express();
const db = new sqlite3.Database(config.DATABASE_PATH);

console.log('🤖 Arsenal Ticket Bot Starting... (Enhanced with Credits System!)');
console.log('👥 Admins:', config.ADMIN_IDS);

// Enhanced Database setup with credits system
function initializeDatabase() {
    console.log('📊 Initializing enhanced database with credits system...');
    db.serialize(() => {
        // Users table with credits system
        db.run(`CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY,
            username TEXT,
            first_name TEXT,
            admin_id INTEGER,
            is_active BOOLEAN DEFAULT 1,
            credits INTEGER DEFAULT 0,
            infinite_credits BOOLEAN DEFAULT 0,
            total_passes_created INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_used DATETIME
        )`);

        // Add credits columns to existing users if they don't exist
        db.run(`ALTER TABLE users ADD COLUMN credits INTEGER DEFAULT 0`, () => {});
        db.run(`ALTER TABLE users ADD COLUMN infinite_credits BOOLEAN DEFAULT 0`, () => {});
        db.run(`ALTER TABLE users ADD COLUMN total_passes_created INTEGER DEFAULT 0`, () => {});

        // Scans table with pass generation tracking
        db.run(`CREATE TABLE IF NOT EXISTS scans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            admin_id INTEGER,
            scan_data TEXT,
            pass_generated BOOLEAN DEFAULT 0,
            pass_filename TEXT,
            credits_used INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(user_id)
        )`);

        // Add pass tracking columns to existing scans if they don't exist
        db.run(`ALTER TABLE scans ADD COLUMN pass_generated BOOLEAN DEFAULT 0`, () => {});
        db.run(`ALTER TABLE scans ADD COLUMN pass_filename TEXT`, () => {});
        db.run(`ALTER TABLE scans ADD COLUMN credits_used INTEGER DEFAULT 0`, () => {});

        // Messages table (for monitoring)
        db.run(`CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            message_text TEXT,
            message_type TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Admin settings
        db.run(`CREATE TABLE IF NOT EXISTS admin_settings (
            admin_id INTEGER PRIMARY KEY,
            monitor_chats BOOLEAN DEFAULT 1,
            notifications BOOLEAN DEFAULT 1
        )`);

        // Credit transactions table for audit trail
        db.run(`CREATE TABLE IF NOT EXISTS credit_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            admin_id INTEGER,
            transaction_type TEXT, -- 'add', 'deduct', 'use', 'set_infinite'
            amount INTEGER,
            balance_before INTEGER,
            balance_after INTEGER,
            infinite_before BOOLEAN,
            infinite_after BOOLEAN,
            description TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(user_id)
        )`);

        // Initialize admin settings
        config.ADMIN_IDS.forEach(adminId => {
            db.run("INSERT OR IGNORE INTO admin_settings (admin_id) VALUES (?)", [adminId]);
        });
    });
    console.log('✅ Enhanced database initialized with credits system');
}

// User management functions
function isAuthorizedUser(userId) {
    return new Promise((resolve) => {
        db.get("SELECT * FROM users WHERE user_id = ? AND is_active = 1", [userId], (err, row) => {
            resolve(!!row);
        });
    });
}

function isAdmin(userId) {
    return config.ADMIN_IDS.includes(userId);
}

function getAdminForUser(userId) {
    return new Promise((resolve) => {
        db.get("SELECT admin_id FROM users WHERE user_id = ?", [userId], (err, row) => {
            resolve(row ? row.admin_id : null);
        });
    });
}

// Credits management functions
function getUserCredits(userId) {
    return new Promise((resolve) => {
        db.get("SELECT credits, infinite_credits FROM users WHERE user_id = ?", [userId], (err, row) => {
            if (err || !row) {
                resolve({ credits: 0, infinite: false });
            } else {
                resolve({ credits: row.credits || 0, infinite: !!row.infinite_credits });
            }
        });
    });
}

function useCredit(userId, adminId, description = 'Pass generation') {
    return new Promise((resolve) => {
        db.get("SELECT credits, infinite_credits FROM users WHERE user_id = ?", [userId], (err, user) => {
            if (err || !user) {
                resolve(false);
                return;
            }

            if (user.infinite_credits) {
                // User has infinite credits, just log the transaction and increment total
                db.run("UPDATE users SET total_passes_created = total_passes_created + 1 WHERE user_id = ?", [userId]);
                logCreditTransaction(userId, adminId, 'use', 1, user.credits, user.credits, user.infinite_credits, user.infinite_credits, description);
                resolve(true);
                return;
            }

            if (user.credits <= 0) {
                resolve(false);
                return;
            }

            // Deduct credit and update totals
            const newBalance = user.credits - 1;
            db.run("UPDATE users SET credits = ?, total_passes_created = total_passes_created + 1 WHERE user_id = ?", 
                   [newBalance, userId], (err) => {
                if (err) {
                    resolve(false);
                    return;
                }
                
                logCreditTransaction(userId, adminId, 'use', 1, user.credits, newBalance, user.infinite_credits, user.infinite_credits, description);
                resolve(true);
            });
        });
    });
}

function addCredits(userId, adminId, amount, description = 'Credits added') {
    return new Promise((resolve) => {
        db.get("SELECT credits, infinite_credits FROM users WHERE user_id = ?", [userId], (err, user) => {
            if (err || !user) {
                resolve(false);
                return;
            }

            const newBalance = user.credits + amount;
            db.run("UPDATE users SET credits = ? WHERE user_id = ?", [newBalance, userId], (err) => {
                if (err) {
                    resolve(false);
                    return;
                }
                
                logCreditTransaction(userId, adminId, 'add', amount, user.credits, newBalance, user.infinite_credits, user.infinite_credits, description);
                resolve(true);
            });
        });
    });
}

function setInfiniteCredits(userId, adminId, infinite = true, description = 'Infinite credits set') {
    return new Promise((resolve) => {
        db.get("SELECT credits, infinite_credits FROM users WHERE user_id = ?", [userId], (err, user) => {
            if (err || !user) {
                resolve(false);
                return;
            }

            db.run("UPDATE users SET infinite_credits = ? WHERE user_id = ?", [infinite ? 1 : 0, userId], (err) => {
                if (err) {
                    resolve(false);
                    return;
                }
                
                logCreditTransaction(userId, adminId, infinite ? 'set_infinite' : 'remove_infinite', 0, user.credits, user.credits, user.infinite_credits, infinite, description);
                resolve(true);
            });
        });
    });
}

function logCreditTransaction(userId, adminId, type, amount, balanceBefore, balanceAfter, infiniteBefore, infiniteAfter, description) {
    db.run(`INSERT INTO credit_transactions 
            (user_id, admin_id, transaction_type, amount, balance_before, balance_after, infinite_before, infinite_after, description) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
           [userId, adminId, type, amount, balanceBefore, balanceAfter, infiniteBefore ? 1 : 0, infiniteAfter ? 1 : 0, description]);
}

// Logging function
function logMessage(userId, messageText, messageType = 'text') {
    db.run("INSERT INTO messages (user_id, message_text, message_type) VALUES (?, ?, ?)", 
           [userId, messageText, messageType]);
}

// ========== CLOUDMERSIVE BARCODE SCANNING ==========
class CloudmersiveBarcodeScanner {
    constructor() {
        this.apiKey = config.CLOUDMERSIVE_API_KEY;
        this.baseUrl = 'https://api.cloudmersive.com/barcode/scan/image';
    }

    async scanBarcodeFromBuffer(imageBuffer) {
        try {
            console.log('🔍 Cloudmersive: Professional barcode scanning...');
            
            const formData = new FormData();
            formData.append('imageFile', imageBuffer, {
                filename: 'barcode.png',
                contentType: 'image/png'
            });

            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: {
                    'Apikey': this.apiKey,
                    ...formData.getHeaders()
                },
                body: formData
            });

            if (!response.ok) {
                throw new Error(`Cloudmersive API error: ${response.status} ${response.statusText}`);
            }

            const result = await response.json();
            
            if (result.Successful && result.RawText) {
                console.log('✅ Cloudmersive: Barcode detected:', result.RawText);
                return {
                    success: true,
                    data: result.RawText,
                    type: result.BarcodeType || 'Unknown',
                    format: result.BarcodeType || 'Unknown',
                    method: 'Cloudmersive Professional API'
                };
            } else {
                console.log('❌ Cloudmersive: No barcode detected');
                return null;
            }

        } catch (error) {
            console.error('❌ Cloudmersive scanning error:', error.message);
            return null;
        }
    }
}

async function scanBarcodeFromImage(imageBuffer) {
    try {
        console.log('🔍 Starting professional barcode scan with Cloudmersive...');
        
        if (!imageBuffer || imageBuffer.length === 0) {
            console.error('❌ Invalid image buffer provided');
            return null;
        }

        console.log('📏 Processing image buffer size:', imageBuffer.length, 'bytes');

        const scanner = new CloudmersiveBarcodeScanner();
        const result = await scanner.scanBarcodeFromBuffer(imageBuffer);
        
        if (result) {
            console.log('✅ SUCCESS: Cloudmersive detected barcode:', result.data);
            return result;
        }

        console.log('❌ Cloudmersive: No barcode detected');
        return null;

    } catch (error) {
        console.error('❌ Barcode scanning error:', error.message);
        return null;
    }
}

// ========== APPLE WALLET PASS GENERATION ==========

// Clean barcode - remove everything after underscore
function cleanBarcodeForPass(barcode) {
    if (!barcode || barcode === 'Not detected') {
        return barcode;
    }
    
    const underscoreIndex = barcode.indexOf('_');
    if (underscoreIndex !== -1) {
        return barcode.substring(0, underscoreIndex);
    }
    
    return barcode;
}

// Generate pass filename based on seat information
function generatePassFilename(ticketData, userId) {
    const area = (ticketData.area || 'UNK').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const row = (ticketData.row || 'UNK').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const seat = (ticketData.seat || 'UNK').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    
    return `${area}_${row}_${seat}`;
}

// Create manifest with SHA1 hashes
function createManifest(folder) {
    const manifest = {};
    const files = fs.readdirSync(folder);
    
    for (const filename of files) {
        if (filename === "signature") continue;
        
        const filePath = path.join(folder, filename);
        const fileData = fs.readFileSync(filePath);
        const sha1 = crypto.createHash('sha1').update(fileData).digest('hex');
        manifest[filename] = sha1;
    }
    
    return manifest;
}

// Sign with OpenSSL
function signWithOpenSSL(folder) {
    console.log(`🔐 Signing pass in: ${folder}`);
    
    const opensslPaths = [
        'openssl',
        'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
        'C:\\Program Files\\OpenSSL-Win64\\bin\\openssl.exe',
        'C:\\OpenSSL-Win64\\bin\\openssl.exe'
    ];
    
    let opensslCmd = 'openssl';
    
    for (const opensslPath of opensslPaths) {
        try {
            execSync(`"${opensslPath}" version`, { stdio: 'ignore' });
            opensslCmd = `"${opensslPath}"`;
            console.log(`✅ Found OpenSSL at: ${opensslPath}`);
            break;
        } catch (e) {
            // Continue to next path
        }
    }
    
    const cmd = [
        opensslCmd, "smime", "-binary", "-sign",
        "-signer", path.resolve(config.PEM_CERT_PATH),
        "-inkey", path.resolve(config.PEM_KEY_PATH), 
        "-certfile", path.resolve(config.WWDR_CERT_PATH),
        "-in", "manifest.json",
        "-out", "signature",
        "-outform", "DER"
    ];
    
    execSync(cmd.join(' '), { cwd: folder });
}

// Force delete folder
function forceDelete(folder) {
    try {
        fs.rmSync(folder, { recursive: true, force: true });
    } catch (error) {
        try {
            execSync(`rmdir /s /q "${folder}"`);
        } catch (e) {
            console.log(`⚠️ Could not delete temp folder: ${folder}`);
        }
    }
}

// Copy directory recursively
function copyDir(src, dest) {
    if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
    }
    
    const files = fs.readdirSync(src);
    for (const file of files) {
        const srcPath = path.join(src, file);
        const destPath = path.join(dest, file);
        
        if (fs.statSync(srcPath).isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

// Create ZIP file
function createZip(folder, outputPath) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(outputPath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        
        output.on('close', resolve);
        archive.on('error', reject);
        
        archive.pipe(output);
        archive.directory(folder, false);
        archive.finalize();
    });
}

// Generate Apple Wallet pass
async function generateWalletPass(ticketData, userId) {
    console.log('🎫 Generating Apple Wallet pass...');
    
    // Create output directory
    if (!fs.existsSync(config.OUTPUT_DIR)) {
        fs.mkdirSync(config.OUTPUT_DIR, { recursive: true });
    }
    
    const serial = `TICKET_${userId}_${Date.now()}`;
    const passFilename = generatePassFilename(ticketData, userId);
    const folder = `temp_${serial}`;
    
    try {
        // Clean up existing temp folder
        if (fs.existsSync(folder)) {
            forceDelete(folder);
        }
        
        // Copy template to temp folder
        copyDir(config.TEMPLATE_DIR, folder);
        console.log('✅ Copied template files');
        
        // Clean barcode for pass
        const cleanedBarcode = cleanBarcodeForPass(ticketData.barcode);
        
        // Create pass.json
        const passJson = {
            "description": "Arsenal Matchday Ticket",
            "formatVersion": 1,
            "organizationName": config.ORG_NAME,
            "passTypeIdentifier": config.PASS_TYPE_ID,
            "teamIdentifier": config.TEAM_ID,
            "serialNumber": serial,
            "backgroundColor": "rgb(145,25,35)",
            "foregroundColor": "rgb(255,255,255)",
            "labelColor": "rgb(255,255,255)",
            "logoText": "",
            "barcodes": [],
            "eventTicket": {
                "headerFields": [
                    {
                        "key": "membership",
                        "label": "MEMBERSHIP", 
                        "value": ticketData.membership || "Member",
                        "textAlignment": "PKTextAlignmentRight"
                    }
                ],
                "primaryFields": [],
                "secondaryFields": [
                    {
                        "key": "game",
                        "label": "NEXT VALID GAME",
                        "value": ticketData.game || "Arsenal Match"
                    },
                    {
                        "key": "kickoff", 
                        "label": "KICK OFF",
                        "value": ticketData.datetime || "TBC",
                        "textAlignment": "PKTextAlignmentRight"
                    }
                ],
                "auxiliaryFields": [
                    {
                        "key": "entry",
                        "label": "ENTER VIA",
                        "value": ticketData.enterVia || "Main Entrance"
                    },
                    {
                        "key": "seat",
                        "label": "SEAT", 
                        "value": ticketData.seat || "TBC",
                        "textAlignment": "PKTextAlignmentRight"
                    },
                    {
                        "key": "area",
                        "label": "AREA",
                        "value": ticketData.area || "TBC"
                    },
                    {
                        "key": "row",
                        "label": "ROW",
                        "value": ticketData.row || "TBC",
                        "textAlignment": "PKTextAlignmentCenter"
                    },
                    {
                        "key": "ticket",
                        "label": "TICKET TYPE",
                        "value": ticketData.ticketType || "Adult",
                        "textAlignment": "PKTextAlignmentRight"
                    }
                ],
                "backFields": []
            }
        };

        // Add cleaned barcode if available
        if (cleanedBarcode && cleanedBarcode !== 'Not detected') {
            passJson.barcodes = [{
                "message": cleanedBarcode,
                "format": "PKBarcodeFormatPDF417",
                "messageEncoding": "iso-8859-1"
            }];
        }
        
        // Write pass.json
        fs.writeFileSync(path.join(folder, "pass.json"), JSON.stringify(passJson, null, 4));
        console.log('✅ Created pass.json');
        
        // Create manifest
        const manifest = createManifest(folder);
        fs.writeFileSync(path.join(folder, "manifest.json"), JSON.stringify(manifest, null, 0));
        console.log('✅ Created manifest.json');
        
        // Sign the pass
        signWithOpenSSL(folder);
        console.log('✅ Signed pass');
        
        // Create .pkpass file with custom filename
        const pkpassPath = path.join(config.OUTPUT_DIR, `${passFilename}.pkpass`);
        await createZip(folder, pkpassPath);
        console.log('✅ Created ZIP file');
        
        // Clean up temp folder
        forceDelete(folder);
        console.log('✅ Cleaned up temp files');
        
        console.log(`🎉 SUCCESS! Apple Wallet pass created: ${pkpassPath}`);
        return { path: pkpassPath, filename: passFilename };
        
    } catch (error) {
        console.error(`❌ Failed to create pass: ${error.message}`);
        
        // Clean up on error
        if (fs.existsSync(folder)) {
            forceDelete(folder);
        }
        throw error;
    }
}

// ========== BOT COMMANDS ==========

bot.onText(/\/start/, async (msg) => {
    const userId = msg.from.id;
    const username = msg.from.username || '';
    const firstName = msg.from.first_name || '';
    
    console.log(`👤 /start command from ${firstName} (${userId})`);
    logMessage(userId, '/start', 'command');
    
    if (isAdmin(userId)) {
        const adminMessage = `🔧 *Arsenal Ticket Bot - Admin Panel*\n\n` +
                           `Welcome ${firstName}! You are an administrator.\n\n` +
                           `*Client Management:*\n` +
                           `/adduser @username - Add new client\n` +
                           `/listusers - View your clients & credits\n` +
                           `/removeuser @username - Remove client\n\n` +
                           `*Credit Management:* 💳\n` +
                           `/addcredits @username 5 - Add credits\n` +
                           `/infinite @username - Give infinite credits\n` +
                           `/credits @username - Check user credits\n` +
                           `/transactions @username - View credit history\n\n` +
                           `*Statistics:*\n` +
                           `/stats - Usage statistics\n\n` +
                           `*Enhanced Features:* 🆕\n` +
                           `• Professional barcode scanning\n` +
                           `• Apple Wallet pass generation 📱\n` +
                           `• Credit-based system 💳\n` +
                           `• Comprehensive user management\n\n` +
                           `*Test the bot:* Send a ticket image to test scanning and wallet generation!`;
        
        bot.sendMessage(userId, adminMessage, { parse_mode: 'Markdown' });
        return;
    }
    
    const isAuthorized = await isAuthorizedUser(userId);
    if (!isAuthorized) {
        bot.sendMessage(userId, '❌ *Access Denied*\n\nThis bot is private and requires authorization.\n\nPlease contact an administrator to request access.', { parse_mode: 'Markdown' });
        return;
    }
    
    db.run("UPDATE users SET last_used = CURRENT_TIMESTAMP WHERE user_id = ?", [userId]);
    
    // Get user credits info
    const userCredits = await getUserCredits(userId);
    const creditsText = userCredits.infinite ? 
        'Unlimited 💎' : 
        `${userCredits.credits} credits remaining`;
    
    const welcomeMessage = `🎫 *Arsenal Ticket Scanner* 🆕\n\n` +
                          `Hello ${firstName}! Welcome to the enhanced Arsenal ticket scanner.\n\n` +
                          `💳 *Your Credits:* ${creditsText}\n\n` +
                          `📸 *How to use:*\n` +
                          `Send me a screenshot of your Arsenal ticket and I'll:\n` +
                          `• Extract all ticket information 📊\n` +
                          `• Scan barcodes and QR codes 🔍\n` +
                          `• Generate an Apple Wallet pass 📱\n\n` +
                          `*Just send your ticket image now!*`;
    
    bot.sendMessage(userId, welcomeMessage, { parse_mode: 'Markdown' });
});

// Check credits command
bot.onText(/\/credits/, async (msg) => {
    const userId = msg.from.id;
    const firstName = msg.from.first_name || 'User';
    
    if (!isAdmin(userId)) {
        const isAuthorized = await isAuthorizedUser(userId);
        if (!isAuthorized) {
            bot.sendMessage(userId, '❌ Access denied.');
            return;
        }
        
        // Show user their own credits
        const userCredits = await getUserCredits(userId);
        db.get("SELECT total_passes_created FROM users WHERE user_id = ?", [userId], (err, row) => {
            const totalPasses = row ? row.total_passes_created : 0;
            const creditsText = userCredits.infinite ? 
                'Unlimited 💎' : 
                `${userCredits.credits} credits`;
            
            const message = `💳 *Your Credit Balance*\n\n` +
                           `📊 Current Credits: ${creditsText}\n` +
                           `🎫 Total Passes Created: ${totalPasses}\n\n` +
                           `${userCredits.credits <= 0 && !userCredits.infinite ? 
                             '⚠️ You have no credits left. Contact your administrator to add more credits.' : 
                             '✅ You can create passes with your available credits.'}`;
            
            bot.sendMessage(userId, message, { parse_mode: 'Markdown' });
        });
        return;
    }
    
    // Admin checking user credits
    const args = msg.text.split(' ');
    if (args.length < 2) {
        bot.sendMessage(userId, '📝 *Usage:* `/credits @username`\n\nCheck a user\'s credit balance.', { parse_mode: 'Markdown' });
        return;
    }
    
    const targetUsername = args[1].replace('@', '');
    
    db.get("SELECT user_id, first_name, credits, infinite_credits, total_passes_created FROM users WHERE username = ? AND admin_id = ?", 
           [targetUsername, userId], async (err, user) => {
        if (!user) {
            bot.sendMessage(userId, `❌ User @${targetUsername} not found in your client list.`);
            return;
        }
        
        const creditsText = user.infinite_credits ? 
            'Unlimited 💎' : 
            `${user.credits || 0} credits`;
        
        const message = `💳 *Credit Balance for ${user.first_name}*\n\n` +
                       `👤 User: @${targetUsername}\n` +
                       `📊 Current Credits: ${creditsText}\n` +
                       `🎫 Total Passes Created: ${user.total_passes_created || 0}\n\n` +
                       `*Actions:*\n` +
                       `• \`/addcredits @${targetUsername} 5\` - Add 5 credits\n` +
                       `• \`/infinite @${targetUsername}\` - Give unlimited credits`;
        
        bot.sendMessage(userId, message, { parse_mode: 'Markdown' });
    });
});

// Add credits command
bot.onText(/\/addcredits (.+) (\d+)/, async (msg, match) => {
    const adminId = msg.from.id;
    const targetUsername = match[1].replace('@', '');
    const amount = parseInt(match[2]);
    
    if (!isAdmin(adminId)) {
        bot.sendMessage(adminId, '❌ Admin access required.');
        return;
    }
    
    if (amount <= 0 || amount > 1000) {
        bot.sendMessage(adminId, '❌ Invalid amount. Must be between 1 and 1000.');
        return;
    }
    
    db.get("SELECT user_id, first_name FROM users WHERE username = ? AND admin_id = ?", 
           [targetUsername, adminId], async (err, user) => {
        if (!user) {
            bot.sendMessage(adminId, `❌ User @${targetUsername} not found in your client list.`);
            return;
        }
        
        const success = await addCredits(user.user_id, adminId, amount, `Admin added ${amount} credits`);
        if (success) {
            const userCredits = await getUserCredits(user.user_id);
            bot.sendMessage(adminId, `✅ *Credits Added*\n\nAdded ${amount} credits to ${user.first_name} (@${targetUsername})\n\nNew balance: ${userCredits.credits} credits`);
            
            // Notify the user
            bot.sendMessage(user.user_id, `💳 *Credits Added!*\n\nYou received ${amount} new credits.\n\nNew balance: ${userCredits.credits} credits 🎉`);
        } else {
            bot.sendMessage(adminId, '❌ Failed to add credits. Please try again.');
        }
    });
});

// Set infinite credits command
bot.onText(/\/infinite (.+)/, async (msg, match) => {
    const adminId = msg.from.id;
    const targetUsername = match[1].replace('@', '');
    
    if (!isAdmin(adminId)) {
        bot.sendMessage(adminId, '❌ Admin access required.');
        return;
    }
    
    db.get("SELECT user_id, first_name, infinite_credits FROM users WHERE username = ? AND admin_id = ?", 
           [targetUsername, adminId], async (err, user) => {
        if (!user) {
            bot.sendMessage(adminId, `❌ User @${targetUsername} not found in your client list.`);
            return;
        }
        
        const newInfiniteStatus = !user.infinite_credits;
        const success = await setInfiniteCredits(user.user_id, adminId, newInfiniteStatus, 
                                                 newInfiniteStatus ? 'Admin granted infinite credits' : 'Admin removed infinite credits');
        
        if (success) {
            const statusText = newInfiniteStatus ? 'Unlimited 💎' : 'Limited credits';
            bot.sendMessage(adminId, `✅ *Credits Updated*\n\n${user.first_name} (@${targetUsername}) now has: ${statusText}`);
            
            // Notify the user
            const userMessage = newInfiniteStatus ? 
                '💎 *Unlimited Credits Granted!*\n\nYou now have unlimited credits and can create as many passes as needed! 🎉' :
                '💳 *Credits Changed*\n\nYour account has been switched back to limited credits. Check your balance with /credits';
            
            bot.sendMessage(user.user_id, userMessage);
        } else {
            bot.sendMessage(adminId, '❌ Failed to update credits. Please try again.');
        }
    });
});

// View credit transactions
bot.onText(/\/transactions (.+)/, async (msg, match) => {
    const adminId = msg.from.id;
    const targetUsername = match[1].replace('@', '');
    
    if (!isAdmin(adminId)) {
        bot.sendMessage(adminId, '❌ Admin access required.');
        return;
    }
    
    db.get("SELECT user_id, first_name FROM users WHERE username = ? AND admin_id = ?", 
           [targetUsername, adminId], (err, user) => {
        if (!user) {
            bot.sendMessage(adminId, `❌ User @${targetUsername} not found in your client list.`);
            return;
        }
        
        db.all(`SELECT transaction_type, amount, balance_before, balance_after, 
                       infinite_before, infinite_after, description, created_at 
                FROM credit_transactions 
                WHERE user_id = ? 
                ORDER BY created_at DESC LIMIT 10`, [user.user_id], (err, transactions) => {
            
            if (!transactions || transactions.length === 0) {
                bot.sendMessage(adminId, `📊 *Credit History for ${user.first_name}*\n\nNo credit transactions found.`);
                return;
            }
            
            let message = `📊 *Credit History for ${user.first_name}*\n\n`;
            
            transactions.forEach((tx, index) => {
                const date = new Date(tx.created_at).toLocaleDateString('en-GB');
                const time = new Date(tx.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                
                let txIcon = '';
                switch (tx.transaction_type) {
                    case 'add': txIcon = '➕'; break;
                    case 'use': txIcon = '📱'; break;
                    case 'set_infinite': txIcon = '💎'; break;
                    case 'remove_infinite': txIcon = '🔒'; break;
                    default: txIcon = '📊';
                }
                
                const beforeText = tx.infinite_before ? 'Unlimited' : tx.balance_before;
                const afterText = tx.infinite_after ? 'Unlimited' : tx.balance_after;
                
                message += `${txIcon} *${tx.description}*\n`;
                message += `   ${beforeText} → ${afterText}\n`;
                message += `   ${date} ${time}\n\n`;
            });
            
            if (transactions.length === 10) {
                message += '_(Showing last 10 transactions)_';
            }
            
            bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
        });
    });
});

// Admin command: Add user
bot.onText(/\/adduser (.+)/, async (msg, match) => {
    const adminId = msg.from.id;
    const targetUsername = match[1].replace('@', '');
    
    if (!isAdmin(adminId)) {
        bot.sendMessage(adminId, '❌ Admin access required.');
        return;
    }
    
    console.log(`👤 Admin ${adminId} adding user: ${targetUsername}`);
    
    db.get("SELECT * FROM users WHERE username = ?", [targetUsername], (err, row) => {
        if (row) {
            bot.sendMessage(adminId, `❌ User @${targetUsername} is already registered.`);
            return;
        }
        
        db.run("INSERT INTO users (user_id, username, admin_id, is_active, credits) VALUES (0, ?, ?, 0, 0)", 
               [targetUsername, adminId], (err) => {
            if (err) {
                bot.sendMessage(adminId, `❌ Error adding user: ${err.message}`);
                return;
            }
            
            const message = `✅ *User Invitation Created*\n\n` +
                           `Please have @${targetUsername} complete these steps:\n\n` +
                           `1. Start a chat with this bot: @Arsenal_PK_bot\n` +
                           `2. Send the command: /register\n` +
                           `3. They will then be able to use the ticket scanner\n\n` +
                           `⚠️ *Note:* They start with 0 credits. Use \`/addcredits @${targetUsername} 5\` to give them credits.\n\n` +
                           `The invitation is ready and waiting for them!`;
            
            bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
        });
    });
});

// User registration
bot.onText(/\/register/, async (msg) => {
    const userId = msg.from.id;
    const username = msg.from.username || '';
    const firstName = msg.from.first_name || '';
    
    console.log(`👤 Registration attempt from ${firstName} (@${username})`);
    
    if (isAdmin(userId)) {
        bot.sendMessage(userId, '✅ You are already an administrator with full access.');
        return;
    }
    
    db.get("SELECT admin_id FROM users WHERE username = ? AND user_id = 0", [username], (err, row) => {
        if (row) {
            db.run("UPDATE users SET user_id = ?, first_name = ?, is_active = 1 WHERE username = ?", 
                   [userId, firstName, username], (err) => {
                if (err) {
                    bot.sendMessage(userId, '❌ Registration error. Please contact an administrator.');
                    return;
                }
                
                console.log(`✅ User registered: ${firstName} (@${username}) under admin ${row.admin_id}`);
                
                const successMessage = `✅ *Registration Complete!*\n\n` +
                                      `Welcome ${firstName}! You can now use the Arsenal ticket scanner.\n\n` +
                                      `💳 *Credits:* You start with 0 credits. Contact your administrator to add credits.\n\n` +
                                      `📸 *Once you have credits, send me a ticket image to get started!*`;
                
                bot.sendMessage(userId, successMessage, { parse_mode: 'Markdown' });
                
                bot.sendMessage(row.admin_id, `✅ *New Client Registered*\n\n${firstName} (@${username}) has successfully registered.\n\n⚠️ They have 0 credits. Use \`/addcredits @${username} 5\` to give them credits.`, { parse_mode: 'Markdown' });
            });
        } else {
            const errorMessage = `❌ *Registration Not Found*\n\n` +
                               `No pending registration found for @${username}.\n\n` +
                               `Please contact an administrator to request access to this bot.`;
            
            bot.sendMessage(userId, errorMessage, { parse_mode: 'Markdown' });
        }
    });
});

// Admin command: List users (enhanced with credits info)
bot.onText(/\/listusers/, async (msg) => {
    const adminId = msg.from.id;
    
    if (!isAdmin(adminId)) {
        bot.sendMessage(adminId, '❌ Admin access required.');
        return;
    }
    
    db.all(`SELECT username, first_name, is_active, credits, infinite_credits, 
                   total_passes_created, created_at, last_used,
                   (SELECT COUNT(*) FROM scans WHERE scans.user_id = users.user_id) as scan_count
            FROM users 
            WHERE admin_id = ? AND user_id != 0 
            ORDER BY last_used DESC`, [adminId], (err, rows) => {
        
        if (rows.length === 0) {
            bot.sendMessage(adminId, '📋 *Your Clients*\n\nNo clients found. Use /adduser @username to add clients.');
            return;
        }
        
        let message = `👥 *Your Clients (${rows.length})*\n\n`;
        
        rows.forEach((user, index) => {
            const status = user.is_active ? '✅' : '❌';
            const lastUsed = user.last_used ? 
                new Date(user.last_used).toLocaleDateString('en-GB') : 'Never';
            const scanCount = user.scan_count || 0;
            const totalPasses = user.total_passes_created || 0;
            
            const creditsText = user.infinite_credits ? 
                'Unlimited 💎' : 
                `${user.credits || 0} credits`;
            
            message += `${index + 1}. ${status} *${user.first_name}* (@${user.username})\n`;
            message += `   💳 Credits: ${creditsText}\n`;
            message += `   📊 Scans: ${scanCount} | Passes: ${totalPasses}\n`;
            message += `   📅 Last used: ${lastUsed}\n\n`;
        });
        
        message += `*Quick Actions:*\n`;
        message += `• \`/addcredits @username 5\` - Add credits\n`;
        message += `• \`/infinite @username\` - Toggle unlimited\n`;
        message += `• \`/credits @username\` - Check credits\n`;
        message += `• \`/transactions @username\` - View history`;
        
        bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
    });
});

// Admin command: Remove user
bot.onText(/\/removeuser (.+)/, async (msg, match) => {
    const adminId = msg.from.id;
    const targetUsername = match[1].replace('@', '');
    
    if (!isAdmin(adminId)) {
        bot.sendMessage(adminId, '❌ Admin access required.');
        return;
    }
    
    db.run("UPDATE users SET is_active = 0 WHERE username = ? AND admin_id = ?", 
           [targetUsername, adminId], function(err) {
        if (err) {
            bot.sendMessage(adminId, `❌ Error removing user: ${err.message}`);
            return;
        }
        
        if (this.changes === 0) {
            bot.sendMessage(adminId, `❌ User @${targetUsername} not found in your client list.`);
            return;
        }
        
        bot.sendMessage(adminId, `✅ User @${targetUsername} has been deactivated.`);
        console.log(`👤 Admin ${adminId} removed user: ${targetUsername}`);
    });
});

// Admin command: Enhanced Statistics
bot.onText(/\/stats/, async (msg) => {
    const adminId = msg.from.id;
    
    if (!isAdmin(adminId)) {
        bot.sendMessage(adminId, '❌ Admin access required.');
        return;
    }
    
    db.get(`SELECT 
        COUNT(DISTINCT CASE WHEN u.is_active = 1 THEN u.user_id END) as active_users,
        COUNT(DISTINCT u.user_id) as total_users,
        COUNT(DISTINCT CASE WHEN u.infinite_credits = 1 THEN u.user_id END) as unlimited_users,
        SUM(u.credits) as total_credits_distributed,
        SUM(u.total_passes_created) as total_passes_created,
        COUNT(s.id) as total_scans,
        COUNT(CASE WHEN s.created_at >= date('now', '-7 days') THEN 1 END) as scans_this_week,
        COUNT(CASE WHEN s.created_at >= date('now', '-1 day') THEN 1 END) as scans_today,
        COUNT(CASE WHEN s.pass_generated = 1 THEN 1 END) as passes_generated
        FROM users u
        LEFT JOIN scans s ON u.user_id = s.user_id 
        WHERE u.admin_id = ? AND u.user_id != 0`, [adminId], (err, stats) => {
        
        // Get credit usage stats
        db.get(`SELECT 
            COUNT(CASE WHEN transaction_type = 'add' THEN 1 END) as credits_added_count,
            SUM(CASE WHEN transaction_type = 'add' THEN amount ELSE 0 END) as credits_added_total,
            COUNT(CASE WHEN transaction_type = 'use' THEN 1 END) as credits_used_count
            FROM credit_transactions ct
            JOIN users u ON ct.user_id = u.user_id
            WHERE u.admin_id = ?`, [adminId], (err, creditStats) => {
            
            const message = `📊 *Your Enhanced Statistics*\n\n` +
                           `👥 *Clients:*\n` +
                           `   Active: ${stats.active_users || 0}\n` +
                           `   Total: ${stats.total_users || 0}\n` +
                           `   Unlimited: ${stats.unlimited_users || 0}\n\n` +
                           
                           `💳 *Credits:*\n` +
                           `   Distributed: ${stats.total_credits_distributed || 0}\n` +
                           `   Added (total): ${creditStats.credits_added_total || 0}\n` +
                           `   Used: ${creditStats.credits_used_count || 0}\n\n` +
                           
                           `🎫 *Activity:*\n` +
                           `   Total Scans: ${stats.total_scans || 0}\n` +
                           `   Passes Created: ${stats.total_passes_created || 0}\n` +
                           `   This Week: ${stats.scans_this_week || 0}\n` +
                           `   Today: ${stats.scans_today || 0}\n\n` +
                           
                           `🆕 *Enhanced Features:*\n` +
                           `📊 Professional barcode scanning\n` +
                           `📱 Apple Wallet pass generation\n` +
                           `💳 Credit-based system\n` +
                           `🎯 AI-powered extraction\n` +
                           `📈 Comprehensive analytics`;
            
            bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
        });
    });
});

// Enhanced Gemini processing function (unchanged)
async function processImageWithGemini(imageUrl) {
    try {
        console.log('🤖 Processing image with Gemini AI...');
        
        const response = await fetch(imageUrl);
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        
        const requestBody = {
            contents: [{
                parts: [
                    {
                        text: `Analyze this Arsenal FC ticket image very carefully and extract all visible information. Pay special attention to ANY barcode, QR code, or numerical sequences visible ANYWHERE on the ticket.

Return ONLY a JSON object with these exact fields:

{
  "game": "Arsenal v [opponent team]",
  "datetime": "match date and time",
  "area": "area/section/block",
  "row": "row number or letter", 
  "seat": "seat number",
  "ticketType": "ticket category (Adult/Junior/Child/etc)",
  "membership": "membership number if visible",
  "enterVia": "entrance/gate information",
  "barcode": "ANY barcode data, QR code content, or long numerical/alphanumeric sequence visible",
  "ticketNumber": "any ticket reference number or ID visible",
  "additionalCodes": "any other codes, numbers, or identifiers visible on the ticket"
}`
                    },
                    {
                        inline_data: {
                            mime_type: "image/jpeg",
                            data: base64
                        }
                    }
                ]
            }]
        };

        const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${config.GEMINI_API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!geminiResponse.ok) {
            const errorText = await geminiResponse.text();
            console.error('❌ Gemini API error:', geminiResponse.status, errorText);
            throw new Error(`Gemini API error: ${geminiResponse.status}`);
        }

        const data = await geminiResponse.json();
        
        if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
            console.error('❌ Invalid Gemini response structure:', data);
            throw new Error('Invalid response from Gemini API');
        }
        
        const extractedText = data.candidates[0].content.parts[0].text;
        console.log('🤖 Gemini raw response:', extractedText);
        
        const jsonMatch = extractedText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            console.log('✅ Parsed ticket data:', parsed);
            return parsed;
        } else {
            console.error('❌ No JSON found in Gemini response');
            return null;
        }
        
    } catch (error) {
        console.error('❌ Gemini processing error:', error);
        throw new Error(`AI processing failed: ${error.message}`);
    }
}

// Enhanced photo handler with credits system
bot.on('photo', async (msg) => {
    const userId = msg.from.id;
    const firstName = msg.from.first_name || 'User';
    
    console.log(`📸 Photo received from ${firstName} (${userId})`);
    logMessage(userId, 'Sent photo', 'photo');
    
    if (!isAdmin(userId)) {
        const isAuthorized = await isAuthorizedUser(userId);
        if (!isAuthorized) {
            bot.sendMessage(userId, '❌ *Access Denied*\n\nYou are not authorized to use this bot. Contact an administrator for access.');
            return;
        }
        
        // Check credits
        const userCredits = await getUserCredits(userId);
        if (!userCredits.infinite && userCredits.credits <= 0) {
            bot.sendMessage(userId, '💳 *No Credits Available*\n\nYou have no credits left to create passes.\n\nContact your administrator to add more credits to your account.', { parse_mode: 'Markdown' });
            return;
        }
    }
    
    const statusMsg = await bot.sendMessage(userId, '🔍 *Processing your ticket...*\n\n📥 Step 1/4: Downloading image...', { parse_mode: 'Markdown' });
    
    try {
        const photo = msg.photo[msg.photo.length - 1];
        const fileId = photo.file_id;
        
        console.log(`📸 Processing photo file: ${fileId}`);
        
        const file = await bot.getFile(fileId);
        const imageUrl = `https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
        
        await bot.editMessageText('🔍 *Processing your ticket...*\n\n📊 Step 2/4: Scanning barcode...', {
            chat_id: userId,
            message_id: statusMsg.message_id,
            parse_mode: 'Markdown'
        });
        
        const imageResponse = await fetch(imageUrl);
        const imageBuffer = await imageResponse.arrayBuffer();
        const buffer = Buffer.from(imageBuffer);
        
        await bot.editMessageText('🔍 *Processing your ticket...*\n\n🤖 Step 3/4: AI extraction...', {
            chat_id: userId,
            message_id: statusMsg.message_id,
            parse_mode: 'Markdown'
        });
        
        await bot.editMessageText('🔍 *Processing your ticket...*\n\n⚡ Step 4/4: Combining results...', {
            chat_id: userId,
            message_id: statusMsg.message_id,
            parse_mode: 'Markdown'
        });
        
        const [geminiResult, barcodeResult] = await Promise.allSettled([
            processImageWithGemini(imageUrl),
            scanBarcodeFromImage(buffer)
        ]);
        
        let ticketData = null;
        if (geminiResult.status === 'fulfilled' && geminiResult.value) {
            ticketData = geminiResult.value;
        }
        
        if (barcodeResult.status === 'fulfilled' && barcodeResult.value) {
            if (ticketData) {
                ticketData.barcode = barcodeResult.value.data;
            } else {
                ticketData = {
                    game: 'Not detected',
                    datetime: 'Not detected',
                    area: 'Not detected',
                    row: 'Not detected',
                    seat: 'Not detected',
                    ticketType: 'Not detected',
                    membership: 'Not detected',
                    enterVia: 'Not detected',
                    barcode: barcodeResult.value.data
                };
            }
        }
        
        if (ticketData) {
            const adminId = await getAdminForUser(userId) || (isAdmin(userId) ? userId : null);
            if (adminId) {
                db.run("INSERT INTO scans (user_id, admin_id, scan_data) VALUES (?, ?, ?)", 
                       [userId, adminId, JSON.stringify(ticketData)]);
                console.log(`💾 Scan saved for user ${userId} under admin ${adminId}`);
            }
            
            if (!isAdmin(userId)) {
                db.run("UPDATE users SET last_used = CURRENT_TIMESTAMP WHERE user_id = ?", [userId]);
            }
            
            // Show credits info for non-admin users
            let creditsInfo = '';
            if (!isAdmin(userId)) {
                const userCredits = await getUserCredits(userId);
                const creditsText = userCredits.infinite ? 
                    'Unlimited 💎' : 
                    `${userCredits.credits} credits available`;
                creditsInfo = `\n💳 *Credits:* ${creditsText}\n`;
            }
            
            const response = formatTicketInfo(ticketData) + creditsInfo;
            
            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '✅ Generate Wallet Pass', callback_data: 'confirm' },
                        { text: '✏️ Request Edit', callback_data: 'edit' }
                    ]
                ]
            };
            
            await bot.editMessageText(response, {
                chat_id: userId,
                message_id: statusMsg.message_id,
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
            
            global.pendingEdits = global.pendingEdits || {};
            global.pendingEdits[userId] = ticketData;
            
            if (!isAdmin(userId)) {
                const clientAdminId = await getAdminForUser(userId);
                if (clientAdminId) {
                    const barcodeStatus = ticketData.barcode && ticketData.barcode !== 'Not detected' ? 
                        `✅ Barcode detected` : '❌ No barcode';
                    bot.sendMessage(clientAdminId, `📊 *New Scan Alert*\n\n${firstName} scanned: ${ticketData.game || 'Unknown match'}\n${barcodeStatus}`, { parse_mode: 'Markdown' });
                }
            }
            
        } else {
            await bot.editMessageText('❌ *Processing Failed*\n\nI could not extract ticket information from this image.\n\n*Tips for better results:*\n• Ensure the image is clear and well-lit\n• Make sure all text is visible\n• Try taking a new screenshot\n\nPlease try again with a clearer image.', {
                chat_id: userId,
                message_id: statusMsg.message_id,
                parse_mode: 'Markdown'
            });
        }
        
    } catch (error) {
        console.error('❌ Error processing image:', error);
        await bot.editMessageText(`❌ *Processing Error*\n\nSorry, there was an error processing your image: ${error.message}\n\nPlease try again or contact an administrator if the problem persists.`, {
            chat_id: userId,
            message_id: statusMsg.message_id,
            parse_mode: 'Markdown'
        });
    }
});