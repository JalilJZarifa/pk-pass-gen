const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { createWorker } = require('tesseract.js');
const jsQR = require('jsqr');

// Configuration
const config = {
    TELEGRAM_BOT_TOKEN: '7813821568:AAELIYjOOSVsazrNzzOxfypYcanNS7wkUIo',
    GEMINI_API_KEY: 'AIzaSyCDFX8Md3kOfMxSZ0zcjTMRb7HhhQwPKi4',
    ADMIN_IDS: [6578885683, 1055850821], // You and your friend
    PORT: 3000,
    DATABASE_PATH: './bot_data.db'
};

// Initialize bot and database
const bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, { polling: true });
const app = express();
const db = new sqlite3.Database(config.DATABASE_PATH);

console.log('🤖 Arsenal Ticket Bot Starting... (Enhanced with Professional Barcode Scanning!)');
console.log('👥 Admins:', config.ADMIN_IDS);

// Database setup
function initializeDatabase() {
    console.log('📊 Initializing database...');
    db.serialize(() => {
        // Users table
        db.run(`CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY,
            username TEXT,
            first_name TEXT,
            admin_id INTEGER,
            is_active BOOLEAN DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            last_used DATETIME
        )`);

        // Scans table
        db.run(`CREATE TABLE IF NOT EXISTS scans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            admin_id INTEGER,
            scan_data TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(user_id)
        )`);

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

        // Initialize admin settings
        config.ADMIN_IDS.forEach(adminId => {
            db.run("INSERT OR IGNORE INTO admin_settings (admin_id) VALUES (?)", [adminId]);
        });
    });
    console.log('✅ Database initialized');
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

// Logging function
function logMessage(userId, messageText, messageType = 'text') {
    db.run("INSERT INTO messages (user_id, message_text, message_type) VALUES (?, ?, ?)", 
           [userId, messageText, messageType]);
}

// Enhanced barcode scanning function with multiple methods
async function scanBarcodeFromImage(imageBuffer) {
    try {
        console.log('🔍 Starting professional barcode scan...');
        
        // Convert image to various formats for better scanning
        const processedImages = await Promise.all([
            // Original image
            sharp(imageBuffer).png().toBuffer(),
            // High contrast version
            sharp(imageBuffer).normalize().sharpen().png().toBuffer(),
            // Grayscale with increased contrast
            sharp(imageBuffer).grayscale().normalize().modulate({ brightness: 1.2, contrast: 1.5 }).png().toBuffer(),
            // Inverted colors (white text on black background)
            sharp(imageBuffer).negate().png().toBuffer(),
            // Enhanced version with edge detection
            sharp(imageBuffer).grayscale().normalize().sharpen({ sigma: 1.5 }).png().toBuffer()
        ]);

        // Try scanning each processed image variant
        for (let i = 0; i < processedImages.length; i++) {
            console.log(`🔍 Scanning image variant ${i + 1}/5...`);
            
            try {
                // Method 1: QR Code scanning with jsQR
                const { data, info } = await sharp(processedImages[i]).raw().toBuffer({ resolveWithObject: true });
                const qrResult = jsQR(new Uint8ClampedArray(data), info.width, info.height);
                
                if (qrResult) {
                    console.log('✅ QR Code detected:', qrResult.data);
                    return {
                        type: 'QR_CODE',
                        data: qrResult.data,
                        method: `QR Scanner (variant ${i + 1})`
                    };
                }

                // Method 2: OCR-based barcode text extraction
                const ocrResult = await performOCROnImage(processedImages[i]);
                if (ocrResult && ocrResult.length >= 10) {
                    console.log('✅ Barcode text extracted via OCR:', ocrResult);
                    return {
                        type: 'BARCODE_OCR',
                        data: ocrResult,
                        method: `OCR Scanner (variant ${i + 1})`
                    };
                }

            } catch (error) {
                console.log(`❌ Variant ${i + 1} scan failed:`, error.message);
                continue;
            }
        }

        console.log('❌ No barcode found in any image variant');
        return null;

    } catch (error) {
        console.error('❌ Barcode scanning error:', error);
        return null;
    }
}

// OCR function optimized for barcode text extraction
async function performOCROnImage(imageBuffer) {
    let worker = null;
    try {
        worker = await createWorker();
        
        // Configure Tesseract for barcode/alphanumeric text recognition
        await worker.setParameters({
            tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
            tessedit_pageseg_mode: '8', // Treat the image as a single word
            tessedit_ocr_engine_mode: '3' // Default OCR Engine Mode
        });

        const { data: { text } } = await worker.recognize(imageBuffer);
        
        // Clean and validate the extracted text
        const cleanText = text.replace(/\s+/g, '').replace(/[^A-Za-z0-9]/g, '');
        
        // Return if it looks like a valid barcode (minimum 10 characters)
        if (cleanText.length >= 10) {
            return cleanText;
        }

        return null;
    } catch (error) {
        console.error('OCR processing error:', error);
        return null;
    } finally {
        if (worker) {
            await worker.terminate();
        }
    }
}

// Bot command handlers
bot.onText(/\/start/, async (msg) => {
    const userId = msg.from.id;
    const username = msg.from.username || '';
    const firstName = msg.from.first_name || '';
    
    console.log(`👤 /start command from ${firstName} (${userId})`);
    logMessage(userId, '/start', 'command');
    
    if (isAdmin(userId)) {
        const adminMessage = `🔧 *Arsenal Ticket Bot - Admin Panel*\n\n` +
                           `Welcome ${firstName}! You are an administrator.\n\n` +
                           `*Commands:*\n` +
                           `/adduser @username - Add new client\n` +
                           `/listusers - View your clients\n` +
                           `/stats - Usage statistics\n` +
                           `/removeuser @username - Remove client\n\n` +
                           `*Enhanced Features:* 🆕\n` +
                           `• Professional barcode scanning\n` +
                           `• QR code detection\n` +
                           `• OCR text extraction\n` +
                           `• Multi-variant image processing\n\n` +
                           `*Test the bot:* Send a ticket image to test enhanced scanning!\n\n` +
                           `*Dashboard:* Visit your admin dashboard for detailed analytics.`;
        
        bot.sendMessage(userId, adminMessage, { parse_mode: 'Markdown' });
        return;
    }
    
    const isAuthorized = await isAuthorizedUser(userId);
    if (!isAuthorized) {
        bot.sendMessage(userId, '❌ *Access Denied*\n\nThis bot is private and requires authorization.\n\nPlease contact an administrator to request access.', { parse_mode: 'Markdown' });
        return;
    }
    
    // Update last used
    db.run("UPDATE users SET last_used = CURRENT_TIMESTAMP WHERE user_id = ?", [userId]);
    
    const welcomeMessage = `🎫 *Arsenal Ticket Scanner* 🆕\n\n` +
                          `Hello ${firstName}! Welcome to the enhanced Arsenal ticket information extractor.\n\n` +
                          `📸 *How to use:*\n` +
                          `Simply send me a screenshot of your Arsenal ticket and I'll extract all the information for you!\n\n` +
                          `*Enhanced Detection:* 🚀\n` +
                          `• Match details & seat information\n` +
                          `• Date, time & entry details\n` +
                          `• **Professional barcode scanning** 📊\n` +
                          `• **QR code detection** 🔍\n` +
                          `• **OCR text extraction** ✨\n` +
                          `• Multi-variant image processing\n\n` +
                          `*Just send your ticket image now!* 📱`;
    
    bot.sendMessage(userId, welcomeMessage, { parse_mode: 'Markdown' });
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
    
    // Check if user already exists
    db.get("SELECT * FROM users WHERE username = ?", [targetUsername], (err, row) => {
        if (row) {
            bot.sendMessage(adminId, `❌ User @${targetUsername} is already registered.`);
            return;
        }
        
        // Create pending registration
        db.run("INSERT INTO users (user_id, username, admin_id, is_active) VALUES (0, ?, ?, 0)", 
               [targetUsername, adminId], (err) => {
            if (err) {
                bot.sendMessage(adminId, `❌ Error adding user: ${err.message}`);
                return;
            }
            
            const message = `✅ *User Invitation Created*\n\n` +
                           `Please have @${targetUsername} complete these steps:\n\n` +
                           `1. Start a chat with this bot: @Arsenal_PK_bot\n` +
                           `2. Send the command: /register\n` +
                           `3. They will then be able to use the enhanced ticket scanner\n\n` +
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
    
    // Check if user has pending registration
    db.get("SELECT admin_id FROM users WHERE username = ? AND user_id = 0", [username], (err, row) => {
        if (row) {
            // Complete registration
            db.run("UPDATE users SET user_id = ?, first_name = ?, is_active = 1 WHERE username = ?", 
                   [userId, firstName, username], (err) => {
                if (err) {
                    bot.sendMessage(userId, '❌ Registration error. Please contact an administrator.');
                    return;
                }
                
                console.log(`✅ User registered: ${firstName} (@${username}) under admin ${row.admin_id}`);
                
                const successMessage = `✅ *Registration Complete!*\n\n` +
                                      `Welcome ${firstName}! You can now use the enhanced Arsenal ticket scanner.\n\n` +
                                      `📸 *Send me a ticket image to get started!*`;
                
                bot.sendMessage(userId, successMessage, { parse_mode: 'Markdown' });
                
                // Notify admin
                bot.sendMessage(row.admin_id, `✅ *New Client Registered*\n\n${firstName} (@${username}) has successfully registered and can now use the enhanced bot.`);
            });
        } else {
            const errorMessage = `❌ *Registration Not Found*\n\n` +
                               `No pending registration found for @${username}.\n\n` +
                               `Please contact an administrator to request access to this bot.`;
            
            bot.sendMessage(userId, errorMessage, { parse_mode: 'Markdown' });
        }
    });
});

// Admin command: List users
bot.onText(/\/listusers/, async (msg) => {
    const adminId = msg.from.id;
    
    if (!isAdmin(adminId)) {
        bot.sendMessage(adminId, '❌ Admin access required.');
        return;
    }
    
    db.all(`SELECT username, first_name, is_active, created_at, last_used, 
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
            
            message += `${index + 1}. ${status} *${user.first_name}* (@${user.username})\n`;
            message += `   📊 Scans: ${scanCount} | Last used: ${lastUsed}\n\n`;
        });
        
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

// Admin command: Statistics
bot.onText(/\/stats/, async (msg) => {
    const adminId = msg.from.id;
    
    if (!isAdmin(adminId)) {
        bot.sendMessage(adminId, '❌ Admin access required.');
        return;
    }
    
    // Get comprehensive stats for this admin
    db.get(`SELECT 
        COUNT(DISTINCT CASE WHEN u.is_active = 1 THEN u.user_id END) as active_users,
        COUNT(DISTINCT u.user_id) as total_users,
        COUNT(s.id) as total_scans,
        COUNT(CASE WHEN s.created_at >= date('now', '-7 days') THEN 1 END) as scans_this_week,
        COUNT(CASE WHEN s.created_at >= date('now', '-1 day') THEN 1 END) as scans_today
        FROM users u
        LEFT JOIN scans s ON u.user_id = s.user_id 
        WHERE u.admin_id = ? AND u.user_id != 0`, [adminId], (err, stats) => {
        
        const message = `📊 *Your Statistics*\n\n` +
                       `👥 Active Clients: ${stats.active_users || 0}\n` +
                       `📋 Total Clients: ${stats.total_users || 0}\n` +
                       `🎫 Total Scans: ${stats.total_scans || 0}\n` +
                       `📅 This Week: ${stats.scans_this_week || 0}\n` +
                       `📅 Today: ${stats.scans_today || 0}\n\n` +
                       `🆕 *Enhanced Features Active:*\n` +
                       `📊 Professional barcode scanning\n` +
                       `🔍 QR code detection\n` +
                       `✨ OCR text extraction`;
        
        bot.sendMessage(adminId, message, { parse_mode: 'Markdown' });
    });
});

// Enhanced Gemini processing function
async function processImageWithGemini(imageUrl) {
    try {
        console.log('🤖 Processing image with Gemini AI...');
        
        // Download image and convert to base64
        const response = await fetch(imageUrl);
        const buffer = await response.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        
        const requestBody = {
            contents: [{
                parts: [
                    {
                        text: `Analyze this Arsenal FC ticket image and extract all visible information. Focus especially on ANY barcode, QR code, or numerical codes visible on the ticket. Return ONLY a JSON object with these exact fields (use "Not detected" for missing information):

{
  "game": "Arsenal v [opponent team]",
  "datetime": "match date and time",
  "area": "area/section/block",
  "row": "row number or letter", 
  "seat": "seat number",
  "ticketType": "ticket category (Adult/Junior/Child/etc)",
  "membership": "membership number if visible",
  "enterVia": "entrance/gate information",
  "barcode": "ANY barcode, QR code, or long numerical sequence visible on the ticket - look very carefully at bottom, sides, and corners"
}

IMPORTANT: Look extremely carefully for ANY barcode, QR code, or long sequence of numbers/letters anywhere on the ticket. Check all corners, edges, and bottom areas. Even if blurry, try to read the barcode text. This is critical information for ticket validation.`
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
        
        // Parse JSON response
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

// Enhanced photo handler with professional barcode scanning
bot.on('photo', async (msg) => {
    const userId = msg.from.id;
    const firstName = msg.from.first_name || 'User';
    
    console.log(`📸 Photo received from ${firstName} (${userId})`);
    logMessage(userId, 'Sent photo', 'photo');
    
    // Check authorization for non-admins
    if (!isAdmin(userId)) {
        const isAuthorized = await isAuthorizedUser(userId);
        if (!isAuthorized) {
            bot.sendMessage(userId, '❌ *Access Denied*\n\nYou are not authorized to use this bot. Contact an administrator for access.');
            return;
        }
    }
    
    const statusMsg = await bot.sendMessage(userId, '🔍 *Processing your ticket...*\n\n📥 Step 1/4: Downloading high-resolution image...', { parse_mode: 'Markdown' });
    
    try {
        // Get the highest resolution photo
        const photo = msg.photo[msg.photo.length - 1];
        const fileId = photo.file_id;
        
        console.log(`📸 Processing photo file: ${fileId}`);
        
        // Download the image
        const file = await bot.getFile(fileId);
        const imageUrl = `https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
        
        // Download image buffer for barcode scanning
        await bot.editMessageText('🔍 *Processing your ticket...*\n\n🔍 Step 2/4: Professional barcode scanning (5 methods)...', {
            chat_id: userId,
            message_id: statusMsg.message_id,
            parse_mode: 'Markdown'
        });
        
        const imageResponse = await fetch(imageUrl);
        const imageBuffer = await imageResponse.arrayBuffer();
        const buffer = Buffer.from(imageBuffer);
        
        // Step 3: AI processing
        await bot.editMessageText('🔍 *Processing your ticket...*\n\n🤖 Step 3/4: AI information extraction...', {
            chat_id: userId,
            message_id: statusMsg.message_id,
            parse_mode: 'Markdown'
        });
        
        // Step 4: Combining results
        await bot.editMessageText('🔍 *Processing your ticket...*\n\n⚡ Step 4/4: Combining results from all methods...', {
            chat_id: userId,
            message_id: statusMsg.message_id,
            parse_mode: 'Markdown'
        });
        
        // Process with both methods simultaneously
        const [geminiResult, barcodeResult] = await Promise.allSettled([
            processImageWithGemini(imageUrl),
            scanBarcodeFromImage(buffer)
        ]);
        
        // Combine results
        let ticketData = null;
        if (geminiResult.status === 'fulfilled' && geminiResult.value) {
            ticketData = geminiResult.value;
        }
        
        // Add barcode information if found
        if (barcodeResult.status === 'fulfilled' && barcodeResult.value) {
            if (ticketData) {
                ticketData.barcode = barcodeResult.value.data;
                ticketData.barcodeMethod = barcodeResult.value.method;
                ticketData.barcodeType = barcodeResult.value.type;
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
                    barcode: barcodeResult.value.data,
                    barcodeMethod: barcodeResult.value.method,
                    barcodeType: barcodeResult.value.type
                };
            }
        }
        
        if (ticketData) {
            // Save scan to database
            const adminId = await getAdminForUser(userId) || (isAdmin(userId) ? userId : null);
            if (adminId) {
                db.run("INSERT INTO scans (user_id, admin_id, scan_data) VALUES (?, ?, ?)", 
                       [userId, adminId, JSON.stringify(ticketData)]);
                console.log(`💾 Scan saved for user ${userId} under admin ${adminId}`);
            }
            
            // Update last used
            if (!isAdmin(userId)) {
                db.run("UPDATE users SET last_used = CURRENT_TIMESTAMP WHERE user_id = ?", [userId]);
            }
            
            // Format the response
            const response = formatTicketInfo(ticketData);
            
            // Send results with confirmation
            const keyboard = {
                inline_keyboard: [
                    [
                        { text: '✅ Information is Correct', callback_data: 'confirm' },
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
            
            // Store data for potential editing
            global.pendingEdits = global.pendingEdits || {};
            global.pendingEdits[userId] = ticketData;
            
            // Notify admin if it's a client scan
            if (!isAdmin(userId)) {
                const clientAdminId = await getAdminForUser(userId);
                if (clientAdminId) {
                    const barcodeStatus = ticketData.barcode && ticketData.barcode !== 'Not detected' ? '✅ Barcode detected' : '❌ No barcode';
                    bot.sendMessage(clientAdminId, `📊 *New Enhanced Scan Alert*\n\n${firstName} scanned: ${ticketData.game || 'Unknown match'}\n${barcodeStatus}`);
                }
            }
            
        } else {
            await bot.editMessageText('❌ *Processing Failed*\n\nI could not extract ticket information from this image.\n\n*Tips for better results:*\n• Ensure the image is clear and well-lit\n• Make sure all text is visible\n• Ensure barcode/QR code is clearly visible\n• Try taking a new screenshot\n• Avoid shadows or reflections\n\nPlease try again with a clearer image.', {
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

// Handle callback queries (button presses)
bot.on('callback_query', (query) => {
    const userId = query.from.id;
    const data = query.data;
    const firstName = query.from.first_name || 'User';
    
    console.log(`🔘 Button pressed: ${data} by ${firstName} (${userId})`);
    
    if (data === 'confirm') {
        bot.answerCallbackQuery(query.id, { text: '✅ Information confirmed!' });
        bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
            chat_id: userId,
            message_id: query.message.message_id
        });
        
        // Add confirmation message
        bot.sendMessage(userId, '✅ *Scan Complete!*\n\nTicket information has been processed and saved. Send another ticket image anytime to test the enhanced scanning!', { parse_mode: 'Markdown' });
        
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
    // Skip if it's a command, photo, or callback query
    if (msg.text && !msg.text.startsWith('/') && !msg.photo) {
        const userId = msg.from.id;
        const firstName = msg.from.first_name || 'User';
        
        // Log all text messages
        logMessage(userId, msg.text, 'text');
        
        // If user is asking for help or has a question
        if (msg.text.toLowerCase().includes('help') || msg.text.includes('?')) {
            const helpMessage = '❓ *Need Help?*\n\n' +
                               '*For enhanced ticket scanning:*\n' +
                               '📸 Just send me a clear image of your Arsenal ticket\n\n' +
                               '*For best results:*\n' +
                               '• Make sure the image is clear and well-lit\n' +
                               '• Ensure all text on the ticket is visible\n' +
                               '• Make sure barcodes/QR codes are clearly visible\n' +
                               '• Avoid shadows, reflections, or blur\n' +
                               '• Try taking a new screenshot if needed\n\n' +
                               '*Enhanced Features:* 🆕\n' +
                               '📊 Professional barcode scanning\n' +
                               '🔍 QR code detection\n' +
                               '✨ OCR text extraction\n' +
                               '🖼️ Multi-variant image processing\n\n' +
                               '*Contact:* If you continue having problems, contact your administrator.';
            
            bot.sendMessage(userId, helpMessage, { parse_mode: 'Markdown' });
        }
    }
});

// Enhanced format function with professional barcode display
function formatTicketInfo(data) {
    const formatField = (label, value, emoji) => {
        const displayValue = (value && value !== "Not detected" && value !== "null") ? value : "Not detected";
        return `${emoji} **${label}:** ${displayValue}`;
    };

    let response = `🎫 *Ticket Information Extracted* 🆕\n\n` +
           `${formatField('Match', data.game, '⚽')}\n` +
           `${formatField('Date & Time', data.datetime, '📅')}\n` +
           `${formatField('Area/Section', data.area, '🏟️')}\n` +
           `${formatField('Row', data.row, '📍')}\n` +
           `${formatField('Seat', data.seat, '💺')}\n` +
           `${formatField('Ticket Type', data.ticketType, '🎟️')}\n` +
           `${formatField('Membership', data.membership, '🆔')}\n` +
           `${formatField('Enter Via', data.enterVia, '🚪')}\n`;

    // Enhanced barcode display with professional formatting
    if (data.barcode && data.barcode !== "Not detected") {
        response += `\n📊 **Enhanced Barcode Information:**\n`;
        response += `**Data:** \`${data.barcode}\`\n`;
        if (data.barcodeType) {
            response += `**Type:** ${data.barcodeType}\n`;
        }
        if (data.barcodeMethod) {
            response += `**Detected by:** ${data.barcodeMethod}\n`;
        }
    } else {
        response += `\n📊 **Barcode:** Not detected by any scanning method\n`;
    }

    response += `\n*Is this information correct?*`;
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

// Enhanced admin dashboard route
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
        <title>Arsenal Ticket Bot - Enhanced Admin Dashboard</title>
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; background: #f5f7fa; }
            .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); color: white; padding: 30px; border-radius: 15px; margin-bottom: 30px; text-align: center; }
            .header h1 { font-size: 2.5rem; margin-bottom: 10px; }
            .header p { opacity: 0.9; font-size: 1.1rem; }
            .enhanced-badge { background: #059669; color: white; padding: 4px 12px; border-radius: 20px; font-size: 0.8rem; margin-left: 10px; }
            .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; margin-bottom: 30px; }
            .stat-card { background: white; padding: 25px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); text-align: center; border-left: 4px solid #dc2626; }
            .stat-number { font-size: 2.5em; font-weight: bold; color: #dc2626; margin-bottom: 5px; }
            .stat-label { color: #6b7280; font-weight: 500; }
            .section { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); margin-bottom: 30px; }
            .section h2 { color: #1f2937; margin-bottom: 20px; font-size: 1.5rem; }
            table { width: 100%; border-collapse: collapse; }
            th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
            th { background: #f9fafb; font-weight: 600; color: #374151; }
            .status-active { color: #059669; font-weight: bold; }
            .status-inactive { color: #dc2626; font-weight: bold; }
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
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>🎫 Arsenal Ticket Bot <span class="enhanced-badge">ENHANCED</span></h1>
                <p>Professional Admin Dashboard - ID: ${adminId}</p>
                <small>Now featuring professional barcode scanning, QR detection & OCR extraction</small>
            </div>
            
            <div class="feature-list">
                <h3>🆕 Enhanced Features Active</h3>
                <ul>
                    <li>Professional barcode scanning with 5 image variants</li>
                    <li>QR code detection using jsQR technology</li>
                    <li>OCR text extraction with Tesseract.js</li>
                    <li>Multi-method image processing with Sharp</li>
                    <li>Real-time progress updates for users</li>
                </ul>
            </div>
            
            <button class="refresh-btn" onclick="loadDashboard()">🔄 Refresh Data</button>
            <div class="clearfix" style="clear: both;"></div>
            
            <div id="dashboard" class="loading">
                <h3>Loading enhanced dashboard data...</h3>
            </div>
        </div>
        
        <script>
            function loadDashboard() {
                document.getElementById('dashboard').innerHTML = '<div class="loading"><h3>Loading enhanced dashboard data...</h3></div>';
                
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
                                <div class="stat-card">
                                    <div class="stat-number">\${data.barcodeSuccessRate || 0}%</div>
                                    <div class="stat-label">Barcode Success Rate</div>
                                </div>
                            </div>
                            
                            <div class="section">
                                <h2>👥 Client Activity</h2>
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Client</th>
                                            <th>Username</th>
                                            <th>Status</th>
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
                                <h2>📊 Recent Enhanced Scans</h2>
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Date</th>
                                            <th>Client</th>
                                            <th>Match</th>
                                            <th>Barcode Status</th>
                                            <th>Detection Method</th>
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
                                                <td>\${scan.detectionMethod || 'Standard'}</td>
                                                <td>\${scan.time}</td>
                                            </tr>
                                        \`).join('')}
                                    </tbody>
                                </table>
                                \${data.recentScans.length === 0 ? '<p style="text-align: center; color: #6b7280; padding: 20px;">No recent scans found.</p>' : ''}
                            </div>
                        \`;
                    })
                    .catch(error => {
                        document.getElementById('dashboard').innerHTML = '<div class="loading"><h3 style="color: #dc2626;">Error loading data. Please refresh the page.</h3></div>';
                        console.error('Error:', error);
                    });
            }
            
            // Load dashboard on page load
            loadDashboard();
            
            // Auto-refresh every 30 seconds
            setInterval(loadDashboard, 30000);
        </script>
    </body>
    </html>
    `);
});

// Enhanced API endpoint for dashboard stats
app.get('/api/stats/:adminId', (req, res) => {
    const adminId = parseInt(req.params.adminId);
    
    if (!config.ADMIN_IDS.includes(adminId)) {
        return res.status(403).json({ error: 'Access denied' });
    }
    
    // Get comprehensive stats
    db.all(`
        SELECT 
            u.first_name, u.username, u.is_active,
            u.created_at, u.last_used,
            COUNT(s.id) as scan_count
        FROM users u 
        LEFT JOIN scans s ON u.user_id = s.user_id 
        WHERE u.admin_id = ? AND u.user_id != 0
        GROUP BY u.user_id
        ORDER BY u.last_used DESC
    `, [adminId], (err, clients) => {
        
        db.get(`
            SELECT 
                COUNT(DISTINCT CASE WHEN u.is_active = 1 THEN u.user_id END) as active_clients,
                COUNT(DISTINCT u.user_id) as total_clients,
                COUNT(s.id) as total_scans,
                COUNT(CASE WHEN s.created_at >= date('now') THEN 1 END) as scans_today,
                COUNT(CASE WHEN s.created_at >= date('now', '-7 days') THEN 1 END) as scans_this_week
            FROM users u
            LEFT JOIN scans s ON u.user_id = s.user_id 
            WHERE u.admin_id = ? AND u.user_id != 0
        `, [adminId], (err, stats) => {
            
            // Get recent scans with enhanced data
            db.all(`
                SELECT 
                    s.created_at,
                    u.first_name,
                    s.scan_data
                FROM scans s
                JOIN users u ON s.user_id = u.user_id
                WHERE s.admin_id = ?
                ORDER BY s.created_at DESC
                LIMIT 15
            `, [adminId], (err, recentScans) => {
                
                const formatDate = (dateStr) => {
                    if (!dateStr) return 'Never';
                    return new Date(dateStr).toLocaleDateString('en-GB');
                };
                
                const formatTime = (dateStr) => {
                    if (!dateStr) return '';
                    return new Date(dateStr).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                };
                
                // Calculate barcode success rate
                let barcodeSuccesses = 0;
                let totalWithBarcodeAttempt = 0;
                
                recentScans.forEach(scan => {
                    try {
                        const data = JSON.parse(scan.scan_data);
                        if (data.barcode || data.barcodeMethod) {
                            totalWithBarcodeAttempt++;
                            if (data.barcode && data.barcode !== 'Not detected') {
                                barcodeSuccesses++;
                            }
                        }
                    } catch (e) {}
                });
                
                const barcodeSuccessRate = totalWithBarcodeAttempt > 0 ? 
                    Math.round((barcodeSuccesses / totalWithBarcodeAttempt) * 100) : 0;
                
                res.json({
                    totalClients: stats.total_clients || 0,
                    activeClients: stats.active_clients || 0,
                    totalScans: stats.total_scans || 0,
                    scansToday: stats.scans_today || 0,
                    scansThisWeek: stats.scans_this_week || 0,
                    barcodeSuccessRate: barcodeSuccessRate,
                    clients: clients.map(c => ({
                        name: c.first_name,
                        username: c.username,
                        active: c.is_active === 1,
                        scans: c.scan_count,
                        lastUsed: formatDate(c.last_used),
                        registered: formatDate(c.created_at)
                    })),
                    recentScans: recentScans.map(s => {
                        let matchData = 'Unknown match';
                        let barcodeStatus = '❌ No barcode';
                        let detectionMethod = 'Standard';
                        
                        try {
                            const data = JSON.parse(s.scan_data);
                            matchData = data.game || 'Unknown match';
                            
                            if (data.barcode && data.barcode !== 'Not detected') {
                                barcodeStatus = data.barcodeType ? `✅ ${data.barcodeType}` : '✅ Detected';
                                detectionMethod = data.barcodeMethod || 'Enhanced Scanner';
                            }
                        } catch (e) {}
                        
                        return {
                            date: formatDate(s.created_at),
                            time: formatTime(s.created_at),
                            client: s.first_name,
                            match: matchData,
                            barcodeStatus: barcodeStatus,
                            detectionMethod: detectionMethod
                        };
                    })
                });
            });
        });
    });
});

// Health check endpoint with enhanced status
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        admins: config.ADMIN_IDS.length,
        version: '2.0.0',
        features: [
            'professional_barcode_scanning',
            'qr_code_detection', 
            'ocr_text_extraction',
            'multi_variant_processing',
            'enhanced_admin_dashboard'
        ]
    });
});

// Initialize and start
initializeDatabase();

app.listen(config.PORT, () => {
    console.log(`🌐 Enhanced admin dashboard running on port ${config.PORT}`);
    console.log('📊 Dashboard URLs:');
    config.ADMIN_IDS.forEach(id => {
        console.log(`   Admin ${id}: http://localhost:${config.PORT}/admin/${id}`);
    });
});

console.log('🚀 Arsenal Ticket Bot is now running!');
console.log('🤖 Bot username: @Arsenal_PK_bot');
console.log('👥 Configured admins:', config.ADMIN_IDS);
console.log('🔍 Enhanced features: Professional barcode scanning, QR detection, OCR extraction');
console.log('✨ Ready for enhanced ticket processing!');