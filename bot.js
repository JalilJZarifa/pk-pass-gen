const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { createWorker } = require('tesseract.js');
const jsQR = require('jsqr');
const Quagga = require('quagga').default;
const BarcodeReader = require('javascript-barcode-reader');

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

console.log('🤖 Arsenal Ticket Bot Starting... (Enhanced with QuaggaJS Professional Barcode Scanning!)');
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
// ZXing-JS Implementation (Pure JavaScript - No Native Dependencies)
async function scanWithZXing(imageBuffer) {
    try {
        const { MultiFormatReader, BarcodeFormat, DecodeHintType, RGBLuminanceSource, BinaryBitmap, HybridBinarizer } = require('@zxing/library');
        
        console.log('🔍 ZXing-JS: Starting pure JavaScript scan...');
        
        // Process image with Sharp
        const { data, info } = await sharp(imageBuffer)
            .resize(1200, 900, { fit: 'inside', withoutEnlargement: true })
            .raw()
            .toBuffer({ resolveWithObject: true });
        
        console.log('📷 ZXing-JS: Image processed, dimensions:', info.width, 'x', info.height);
        
        // Convert to RGB format for ZXing
        const rgbData = new Uint8ClampedArray(info.width * info.height * 3);
        for (let i = 0; i < data.length; i += info.channels) {
            const pixelIndex = (i / info.channels) * 3;
            if (info.channels === 1) {
                // Grayscale
                rgbData[pixelIndex] = data[i];     // R
                rgbData[pixelIndex + 1] = data[i]; // G
                rgbData[pixelIndex + 2] = data[i]; // B
            } else if (info.channels >= 3) {
                // RGB or RGBA
                rgbData[pixelIndex] = data[i];     // R
                rgbData[pixelIndex + 1] = data[i + 1]; // G
                rgbData[pixelIndex + 2] = data[i + 2]; // B
            }
        }
        
        // Create ZXing objects
        const luminanceSource = new RGBLuminanceSource(rgbData, info.width, info.height);
        const binaryBitmap = new BinaryBitmap(new HybridBinarizer(luminanceSource));
        
        // Configure barcode formats to detect
        const hints = new Map();
        const formats = [
            BarcodeFormat.QR_CODE,
            BarcodeFormat.CODE_128,
            BarcodeFormat.CODE_39,
            BarcodeFormat.EAN_13,
            BarcodeFormat.EAN_8,
            BarcodeFormat.UPC_A,
            BarcodeFormat.UPC_E,
            BarcodeFormat.CODABAR,
            BarcodeFormat.ITF,
            BarcodeFormat.CODE_93,
            BarcodeFormat.DATA_MATRIX,
            BarcodeFormat.PDF_417
        ];
        hints.set(DecodeHintType.POSSIBLE_FORMATS, formats);
        hints.set(DecodeHintType.TRY_HARDER, true);
        
        const reader = new MultiFormatReader();
        
        console.log('⚙️ ZXing-JS: Attempting barcode detection...');
        
        try {
            const result = reader.decode(binaryBitmap, hints);
            
            if (result && result.getText()) {
                console.log('✅ ZXing-JS: Barcode found:', result.getText());
                return {
                    data: result.getText(),
                    format: result.getBarcodeFormat(),
                    type: result.getBarcodeFormat() === BarcodeFormat.QR_CODE ? 'QR_CODE' : 'BARCODE'
                };
            }
        } catch (decodeError) {
            console.log('❌ ZXing-JS decode error:', decodeError.message);
        }
        
        // Try with different image processing
        console.log('🔍 ZXing-JS: Trying enhanced image processing...');
        
        const enhancedImage = await sharp(imageBuffer)
            .resize(1600, 1200, { fit: 'inside', withoutEnlargement: true })
            .grayscale()
            .normalize()
            .modulate({ brightness: 1.2, contrast: 1.8 })
            .sharpen()
            .raw()
            .toBuffer({ resolveWithObject: true });
        
        // Convert enhanced image
        const enhancedRgbData = new Uint8ClampedArray(enhancedImage.info.width * enhancedImage.info.height * 3);
        for (let i = 0; i < enhancedImage.data.length; i++) {
            const pixelIndex = i * 3;
            enhancedRgbData[pixelIndex] = enhancedImage.data[i];     // R
            enhancedRgbData[pixelIndex + 1] = enhancedImage.data[i]; // G
            enhancedRgbData[pixelIndex + 2] = enhancedImage.data[i]; // B
        }
        
        const enhancedLuminanceSource = new RGBLuminanceSource(enhancedRgbData, enhancedImage.info.width, enhancedImage.info.height);
        const enhancedBinaryBitmap = new BinaryBitmap(new HybridBinarizer(enhancedLuminanceSource));
        
        try {
            const enhancedResult = reader.decode(enhancedBinaryBitmap, hints);
            
            if (enhancedResult && enhancedResult.getText()) {
                console.log('✅ ZXing-JS Enhanced: Barcode found:', enhancedResult.getText());
                return {
                    data: enhancedResult.getText(),
                    format: enhancedResult.getBarcodeFormat(),
                    type: enhancedResult.getBarcodeFormat() === BarcodeFormat.QR_CODE ? 'QR_CODE' : 'BARCODE'
                };
            }
        } catch (enhancedDecodeError) {
            console.log('❌ ZXing-JS enhanced decode error:', enhancedDecodeError.message);
        }
        
        console.log('❌ ZXing-JS: No barcode detected with any method');
        return null;
        
    } catch (error) {
        console.error('❌ ZXing-JS error:', error);
        return null;
    }
}
async function scanBarcodeFromImage(imageBuffer) {
    try {
        console.log('🔍 Starting PURE JAVASCRIPT barcode scan with ZXing-JS...');
        
        // Validate input
        if (!imageBuffer || imageBuffer.length === 0) {
            console.error('❌ Invalid image buffer provided');
            return null;
        }

        console.log('📏 Processing image buffer size:', imageBuffer.length, 'bytes');

        // Try ZXing-JS - Pure JavaScript, no native dependencies
        const zxingResult = await scanWithZXing(imageBuffer);
        
        if (zxingResult) {
            console.log('✅ SUCCESS: ZXing-JS detected barcode:', zxingResult.data);
            return {
                type: zxingResult.type,
                data: zxingResult.data,
                format: zxingResult.format,
                method: 'ZXing-JS Pure JavaScript Scanner'
            };
        }

        console.log('❌ ZXing-JS: No barcode detected');
        return null;

    } catch (error) {
        console.error('❌ Barcode scanning error:', error.message);
        return null;
    }
}


async function scanWithDynamsoft(imageBuffer) {
    return new Promise(async (resolve) => {
        try {
            const dbr = require('barcode4nodejs');
            
            console.log('🔍 Dynamsoft: Initializing enterprise scanner...');
            
            // Initialize with trial license (you'll get a real one)
            dbr.initLicense("t0087pwAAABu4VoCESofHg5xKvib9S4107jVlek3wprZF0zn8g79dU0TKzqVBG9aPWuBPIiwp2YacwjwphW+MfbG/EkZJoMy6pauYzyGxN/46zMND/QYfeiGr;t0089pwAAAETJrrp2XCLmImbdCiITh3BKI+9axCU3IRVtSgi/KiGvRwL4aKDLiFj7SefCSwPrkd5a7CNvR2xW1w9AyIIBFNrgW116WmPZxNaNv+I3U8t6ATZ2IdI=;t0089pwAAAG9lutJnpGTk2gwfCmqSALXDjL9gtdWZgS+O6UCqi4ZhfDZxFnJflXBHWUTSGkCU0pOZaPU75Ec/FqH1OvznnkR8q1P1Ccazi8+Nv5qam9d2AjK2Ic4="); // Trial license
            
            console.log('📷 Dynamsoft: Processing image with enterprise algorithms...');
            
            // Create temp directory
            const tempDir = path.join(__dirname, 'temp');
            if (!fs.existsSync(tempDir)) {
                console.log('📁 Creating temp directory...');
                fs.mkdirSync(tempDir, { recursive: true });
            }
            
            // Save image to temp file (Dynamsoft needs file path)
            const tempPath = path.join(tempDir, `dynamsoft_${Date.now()}.png`);
            
            // Pre-process image for maximum accuracy
            const processedImage = await sharp(imageBuffer)
                .resize(2000, 1500, { fit: 'inside', withoutEnlargement: true })
                .grayscale()
                .normalize()
                .sharpen()
                .png()
                .toBuffer();
            
            fs.writeFileSync(tempPath, processedImage);
            console.log('💾 Dynamsoft: Temp file saved:', tempPath);

            // Use Dynamsoft's industry-leading barcode detection
            dbr.decodeFileAsync(tempPath, dbr.formats.ALL, function(err, results) {
                // Clean up temp file
                try {
                    fs.unlinkSync(tempPath);
                    console.log('🗑️ Temp file cleaned up');
                } catch (e) {
                    console.log('⚠️ Could not delete temp file:', e.message);
                }
                
                if (err) {
                    console.error('❌ Dynamsoft decoding error:', err);
                    resolve(null);
                    return;
                }
                
                if (results && results.length > 0) {
                    console.log('🎯 Dynamsoft: Raw results:', JSON.stringify(results, null, 2));
                    
                    // Sort by confidence/quality if available
                    results.sort((a, b) => {
                        // Prefer results with shorter decoding time (usually more accurate)
                        return (a.time || 999) - (b.time || 999);
                    });
                    
                    console.log(`✅ Dynamsoft: Found ${results.length} barcode(s)`);
                    resolve(results);
                } else {
                    console.log('❌ Dynamsoft: No barcodes detected');
                    resolve(null);
                }
            }, "");
            
        } catch (error) {
            console.error('❌ Dynamsoft scanning error:', error.message);
            resolve(null);
        }
    });
}

// Fixed QuaggaJS Implementation (Replace your existing scanWithQuagga function)
async function scanWithQuaggaSimplified(imageBuffer) {
    return new Promise((resolve) => {
        try {
            console.log('🔍 QuaggaJS: Starting scan...');
            
            // Process image for QuaggaJS
            sharp(imageBuffer)
                .resize(800, 600, { fit: 'inside', withoutEnlargement: true })
                .grayscale()
                .normalize()
                .png()
                .toBuffer()
                .then(processedBuffer => {
                    console.log('📷 QuaggaJS: Image processed, size:', processedBuffer.length, 'bytes');
                    
                    // Create temp directory
                    const tempDir = path.join(__dirname, 'temp');
                    if (!fs.existsSync(tempDir)) {
                        console.log('📁 Creating temp directory...');
                        fs.mkdirSync(tempDir, { recursive: true });
                    }
                    
                    // Save temporary file
                    const tempPath = path.join(tempDir, `barcode_${Date.now()}.png`);
                    fs.writeFileSync(tempPath, processedBuffer);
                    console.log('💾 Temp file saved:', tempPath);

                    // QuaggaJS configuration for Node.js
                    const config = {
                        src: tempPath,
                        numOfWorkers: 0, // CRITICAL for Node.js
                        inputStream: {
                            size: 800
                        },
                        locator: {
                            patchSize: "medium",
                            halfSample: true
                        },
                        decoder: {
                            readers: [
                                "code_128_reader",
                                "ean_reader", 
                                "ean_8_reader",
                                "code_39_reader",
                                "upc_reader",
                                "i2of5_reader"
                            ]
                        },
                        locate: true
                    };

                    console.log('⚙️ QuaggaJS: Starting decodeSingle...');

                    // Use decodeSingle for Node.js
                    Quagga.decodeSingle(config, (result) => {
                        console.log('📊 QuaggaJS: Callback received');
                        
                        // Clean up temp file
                        try {
                            fs.unlinkSync(tempPath);
                            console.log('🗑️ Temp file cleaned up');
                        } catch (e) {
                            console.log('⚠️ Could not delete temp file:', e.message);
                        }
                        
                        if (result && result.codeResult) {
                            console.log('🎯 QuaggaJS: Raw result:', JSON.stringify(result.codeResult, null, 2));
                            
                            if (result.codeResult.code) {
                                console.log('✅ QuaggaJS: Barcode found:', result.codeResult.code);
                                resolve({
                                    code: result.codeResult.code,
                                    format: result.codeResult.format || 'Unknown'
                                });
                            } else {
                                console.log('❌ QuaggaJS: No code in result');
                                resolve(null);
                            }
                        } else {
                            console.log('❌ QuaggaJS: No codeResult in callback');
                            resolve(null);
                        }
                    });
                })
                .catch(error => {
                    console.error('❌ QuaggaJS image processing error:', error.message);
                    resolve(null);
                });
        } catch (error) {
            console.error('❌ QuaggaJS error:', error.message);
            resolve(null);
        }
    });
}

// Fixed JavaScript Barcode Reader Implementation (Replace your existing scanWithJavaScriptBarcodeReader function)
async function scanWithJavaScriptBarcodeReader(imageBuffer) {
    try {
        console.log('🔍 Starting JavaScript Barcode Reader scan...');
        
        // Process image to proper format for javascript-barcode-reader
        const { data, info } = await sharp(imageBuffer)
            .resize(800, 600, { fit: 'inside', withoutEnlargement: true })
            .grayscale()
            .normalize()
            .threshold(128) // Binary threshold for better contrast
            .raw()
            .toBuffer({ resolveWithObject: true });

        // Convert to Uint8ClampedArray as expected by the library
        const imageData = {
            data: new Uint8ClampedArray(data),
            width: info.width,
            height: info.height
        };

        // Try different barcode types one by one
        const barcodeTypes = [
            'code-128',
            'code-39', 
            'code-93',
            'codabar',
            'ean-13',
            'ean-8',
            'code-2of5',  // Standard 2 of 5
            'inter25'     // Interleaved 2 of 5
        ];

        for (const barcodeType of barcodeTypes) {
            try {
                console.log(`🔍 Trying ${barcodeType}...`);
                
                // Use the correct import and function call
                const javascriptBarcodeReader = require('javascript-barcode-reader');
                
                const result = await javascriptBarcodeReader({
                    image: imageData,
                    barcode: barcodeType,
                    options: {
                        useAdaptiveThreshold: true, // Better for varied lighting
                        singlePass: false // More thorough scanning
                    }
                });
                
                if (result) {
                    console.log('✅ JavaScript Barcode Reader detected:', result);
                    return {
                        code: result,
                        format: barcodeType
                    };
                }
            } catch (e) {
                // Continue to next barcode type
                console.log(`❌ ${barcodeType} failed:`, e.message);
                continue;
            }
        }

        console.log('❌ JavaScript Barcode Reader: No barcode detected with any type');
        return null;
        
    } catch (error) {
        console.error('JavaScript Barcode Reader error:', error);
        return null;
    }
}

// jsQR Implementation (for QR codes)
// Fixed jsQR Implementation (Replace your existing scanWithJsQR function)
async function scanWithJsQR(imageBuffer) {
    try {
        console.log('🔍 Starting jsQR scan...');
        
        // Process image for optimal QR code detection
        let processedImage = await sharp(imageBuffer)
            .resize(1000, 1000, { fit: 'inside', withoutEnlargement: true })
            .grayscale()
            .normalize()
            .png()
            .toBuffer();

        // Convert to ImageData format expected by jsQR
        const { data, info } = await sharp(processedImage)
            .raw()
            .toBuffer({ resolveWithObject: true });

        // jsQR expects RGBA format, so we need to convert grayscale to RGBA
        const rgbaData = new Uint8ClampedArray(info.width * info.height * 4);
        for (let i = 0; i < data.length; i++) {
            const grayValue = data[i];
            const rgbaIndex = i * 4;
            rgbaData[rgbaIndex] = grayValue;     // R
            rgbaData[rgbaIndex + 1] = grayValue; // G
            rgbaData[rgbaIndex + 2] = grayValue; // B
            rgbaData[rgbaIndex + 3] = 255;       // A (fully opaque)
        }

        // Try scanning the main image
        let qrResult = jsQR(rgbaData, info.width, info.height, {
            inversionAttempts: "dontInvert" // Try different inversion strategies
        });
        
        if (qrResult && qrResult.data) {
            console.log('✅ QR Code detected:', qrResult.data);
            return qrResult.data;
        }

        // Try with inverted colors
        console.log('🔍 Trying inverted image...');
        const invertedImage = await sharp(imageBuffer)
            .resize(1000, 1000, { fit: 'inside', withoutEnlargement: true })
            .grayscale()
            .normalize()
            .negate() // Invert colors
            .png()
            .toBuffer();

        const { data: invertedData, info: invertedInfo } = await sharp(invertedImage)
            .raw()
            .toBuffer({ resolveWithObject: true });

        const invertedRgbaData = new Uint8ClampedArray(invertedInfo.width * invertedInfo.height * 4);
        for (let i = 0; i < invertedData.length; i++) {
            const grayValue = invertedData[i];
            const rgbaIndex = i * 4;
            invertedRgbaData[rgbaIndex] = grayValue;     // R
            invertedRgbaData[rgbaIndex + 1] = grayValue; // G
            invertedRgbaData[rgbaIndex + 2] = grayValue; // B
            invertedRgbaData[rgbaIndex + 3] = 255;       // A
        }

        qrResult = jsQR(invertedRgbaData, invertedInfo.width, invertedInfo.height, {
            inversionAttempts: "attemptBoth"
        });

        if (qrResult && qrResult.data) {
            console.log('✅ QR Code detected (inverted):', qrResult.data);
            return qrResult.data;
        }

        console.log('❌ jsQR: No QR code detected');
        return null;
        
    } catch (error) {
        console.error('jsQR scanning error:', error);
        return null;
    }
}

// Fixed Enhanced OCR Implementation (Replace your existing performBarcodeOCR function)
async function performBarcodeOCR(imageBuffer) {
    let worker = null;
    try {
        console.log('🔍 Starting Enhanced OCR scan...');
        
        worker = await createWorker();
        
        // Configure OCR specifically for barcode text with optimized settings
        await worker.setParameters({
            tessedit_char_whitelist: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_*+',
            tessedit_pageseg_mode: '6', // Uniform block of text (better for barcodes)
            tessedit_ocr_engine_mode: '1', // Neural nets LSTM
            preserve_interword_spaces: '0',
            classify_enable_learning: '0',
            textord_really_old_xheight: '1',
            textord_minimum_height: '10'
        });

        // Try multiple image preprocessing variants
        const imageVariants = await Promise.all([
            // Original with enhancement
            sharp(imageBuffer)
                .resize(1600, 1200, { fit: 'inside', withoutEnlargement: true })
                .grayscale()
                .normalize()
                .sharpen()
                .threshold(128)
                .png()
                .toBuffer(),
            
            // High contrast variant
            sharp(imageBuffer)
                .resize(1600, 1200, { fit: 'inside', withoutEnlargement: true })
                .grayscale()
                .modulate({ brightness: 1.2, contrast: 2.0 })
                .threshold(100)
                .png()
                .toBuffer(),
            
            // Inverted variant
            sharp(imageBuffer)
                .resize(1600, 1200, { fit: 'inside', withoutEnlargement: true })
                .grayscale()
                .normalize()
                .negate()
                .threshold(128)
                .png()
                .toBuffer()
        ]);

        let bestMatch = null;
        let maxLength = 0;

        // Try OCR on each variant
        for (let i = 0; i < imageVariants.length; i++) {
            try {
                console.log(`🔍 OCR variant ${i + 1}...`);
                
                const { data: { text } } = await worker.recognize(imageVariants[i]);
                console.log(`OCR result ${i + 1}:`, text);
                
                // Enhanced barcode pattern matching with better regex
                const barcodePatterns = [
                    /\b[A-Z0-9]{12,30}\b/g,         // Long alphanumeric sequences
                    /\b\d{12,18}\b/g,               // Long numeric sequences (UPC, EAN)
                    /\b[A-Z]{2,4}\d{8,20}\b/g,      // Mixed patterns (letters + numbers)
                    /\b\d{8,12}[A-Z0-9]{2,8}\b/g,  // Numeric + alphanumeric
                    /\b[0-9A-F]{16,32}\b/g,         // Hexadecimal patterns
                    /\b[A-Z0-9*+-]{10,30}\b/g,      // Barcode with special characters
                    /(?:^\s*|\s+)([A-Z0-9]{10,})\s*$/gm, // Full line patterns
                    /\*[A-Z0-9+-]*\*/g              // Code 39 patterns with asterisks
                ];

                for (const pattern of barcodePatterns) {
                    const matches = text.match(pattern);
                    if (matches) {
                        for (const match of matches) {
                            const cleanMatch = match.trim().replace(/[^\w\-]/g, '');
                            if (cleanMatch.length > maxLength && cleanMatch.length >= 8) {
                                // Validate it looks like a real barcode
                                if (!/^(.)\1{5,}$/.test(cleanMatch)) { // Not just repeated characters
                                    bestMatch = cleanMatch;
                                    maxLength = cleanMatch.length;
                                    console.log(`✅ Found barcode pattern: ${cleanMatch} (variant ${i + 1})`);
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                console.log(`OCR variant ${i + 1} failed:`, e.message);
                continue;
            }
        }

        if (bestMatch) {
            console.log('✅ Best barcode pattern found via OCR:', bestMatch);
            return bestMatch;
        }

        console.log('❌ Enhanced OCR: No barcode pattern detected');
        return null;
        
    } catch (error) {
        console.error('Enhanced OCR error:', error);
        return null;
    } finally {
        if (worker) {
            await worker.terminate();
        }
    }
}

// Fixed Image Variants Scanner (Replace your existing scanImageVariants function)
async function scanImageVariants(imageBuffer) {
    try {
        console.log('🔍 Creating image variants for ZXing-JS...');
        
        const variants = [
            // Variant 1: High contrast
            sharp(imageBuffer)
                .resize(1600, 1200, { fit: 'inside', withoutEnlargement: true })
                .grayscale()
                .normalize()
                .modulate({ brightness: 1.3, contrast: 2.2 })
                .sharpen({ sigma: 2 })
                .png()
                .toBuffer(),
            
            // Variant 2: Inverted colors
            sharp(imageBuffer)
                .resize(1600, 1200, { fit: 'inside', withoutEnlargement: true })
                .grayscale()
                .negate()
                .normalize()
                .sharpen()
                .png()
                .toBuffer(),
            
            // Variant 3: Edge enhanced
            sharp(imageBuffer)
                .resize(1600, 1200, { fit: 'inside', withoutEnlargement: true })
                .grayscale()
                .convolve({
                    width: 3,
                    height: 3,
                    kernel: [-1, -1, -1, -1, 9, -1, -1, -1, -1]
                })
                .normalize()
                .png()
                .toBuffer(),
            
            // Variant 4: Threshold binary
            sharp(imageBuffer)
                .resize(1600, 1200, { fit: 'inside', withoutEnlargement: true })
                .grayscale()
                .normalize()
                .threshold(128)
                .png()
                .toBuffer()
        ];

        const processedVariants = await Promise.all(variants);

        // Try ZXing-JS on each variant
        for (let i = 0; i < processedVariants.length; i++) {
            console.log(`🔍 ZXing-JS scanning variant ${i + 1}...`);
            
            try {
                const result = await scanWithZXing(processedVariants[i]);
                if (result) {
                    return {
                        type: result.type,
                        data: result.data,
                        format: result.format,
                        method: `ZXing-JS Scanner (variant ${i + 1})`
                    };
                }
            } catch (error) {
                console.error(`ZXing-JS variant ${i + 1} error:`, error.message);
                continue;
            }
        }

        console.log('❌ All ZXing-JS variants failed to detect barcode');
        return null;
        
    } catch (error) {
        console.error('ZXing-JS variant scanning error:', error);
        return null;
    }
}
// ========== END BARCODE SCANNING FUNCTIONS ==========

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
                           `• QuaggaJS professional barcode scanning\n` +
                           `• JavaScript Barcode Reader fallback\n` +
                           `• QR code detection with jsQR\n` +
                           `• OCR text extraction with pattern matching\n` +
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
                          `• **QuaggaJS professional barcode scanning** 📊\n` +
                          `• **Multiple barcode reader fallbacks** 🔍\n` +
                          `• **QR code detection** ✨\n` +
                          `• **Enhanced OCR with pattern matching** 🎯\n` +
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
                       `📊 QuaggaJS professional barcode scanning\n` +
                       `🔍 JavaScript Barcode Reader fallback\n` +
                       `✨ OCR text extraction with pattern matching\n` +
                       `🎯 Multi-variant image processing`;
        
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
                        text: `Analyze this Arsenal FC ticket image very carefully and extract all visible information. Pay special attention to ANY barcode, QR code, or numerical sequences visible ANYWHERE on the ticket - check all corners, edges, top, bottom, and sides of the ticket.

Look for:
1. Traditional black and white striped barcodes
2. QR codes (square patterns)
3. Long sequences of numbers or letters
4. Any encoded data at the bottom or sides of the ticket
5. Membership numbers, ticket numbers, or reference codes

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
  "barcode": "ANY barcode data, QR code content, or long numerical/alphanumeric sequence visible - even if partially obscured, try to read it",
  "ticketNumber": "any ticket reference number or ID visible",
  "additionalCodes": "any other codes, numbers, or identifiers visible on the ticket"
}

CRITICAL: Examine the entire ticket image pixel by pixel for ANY type of barcode, code, or long sequence. Even blurry or partially visible codes should be attempted to be read.`
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
    
    const statusMsg = await bot.sendMessage(userId, '🔍 *Processing your ticket...*\n\n📥 Step 1/5: Downloading high-resolution image...', { parse_mode: 'Markdown' });
    
    try {
        // Get the highest resolution photo
        const photo = msg.photo[msg.photo.length - 1];
        const fileId = photo.file_id;
        
        console.log(`📸 Processing photo file: ${fileId}`);
        
        // Download the image
        const file = await bot.getFile(fileId);
        const imageUrl = `https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
        
        // Download image buffer for barcode scanning
        await bot.editMessageText('🔍 *Processing your ticket...*\n\n🔍 Step 2/5: QuaggaJS professional barcode scanning...', {
            chat_id: userId,
            message_id: statusMsg.message_id,
            parse_mode: 'Markdown'
        });
        
        const imageResponse = await fetch(imageUrl);
        const imageBuffer = await imageResponse.arrayBuffer();
        const buffer = Buffer.from(imageBuffer);
        
        // Step 3: Multiple barcode scanning methods
        await bot.editMessageText('🔍 *Processing your ticket...*\n\n📊 Step 3/5: Multiple barcode scanner fallbacks...', {
            chat_id: userId,
            message_id: statusMsg.message_id,
            parse_mode: 'Markdown'
        });
        
        // Step 4: AI processing
        await bot.editMessageText('🔍 *Processing your ticket...*\n\n🤖 Step 4/5: AI information extraction...', {
            chat_id: userId,
            message_id: statusMsg.message_id,
            parse_mode: 'Markdown'
        });
        
        // Step 5: Combining results
        await bot.editMessageText('🔍 *Processing your ticket...*\n\n⚡ Step 5/5: Combining results from all methods...', {
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
                ticketData.barcodeFormat = barcodeResult.value.format;
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
                    barcodeType: barcodeResult.value.type,
                    barcodeFormat: barcodeResult.value.format
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
                    const barcodeStatus = ticketData.barcode && ticketData.barcode !== 'Not detected' ? 
                        `✅ Barcode detected (${ticketData.barcodeMethod || 'Unknown method'})` : '❌ No barcode';
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
                               '📊 QuaggaJS professional barcode scanning\n' +
                               '🔍 JavaScript Barcode Reader fallback\n' +
                               '✨ OCR text extraction with pattern matching\n' +
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
        if (data.barcodeFormat) {
            response += `**Format:** ${data.barcodeFormat}\n`;
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
                <small>Now featuring QuaggaJS professional barcode scanning with multiple fallbacks</small>
            </div>
            
            <div class="feature-list">
                <h3>🆕 Enhanced Features Active</h3>
                <ul>
                    <li>QuaggaJS professional barcode scanning for traditional barcodes</li>
                    <li>JavaScript Barcode Reader as secondary fallback scanner</li>
                    <li>jsQR for QR code detection and scanning</li>
                    <li>Enhanced OCR text extraction with barcode pattern matching</li>
                    <li>Multi-variant image processing with Sharp</li>
                    <li>Real-time progress updates for users during scanning</li>
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
        version: '3.0.0',
        features: [
            'quagga_js_professional_barcode_scanning',
            'javascript_barcode_reader_fallback',
            'jsqr_qr_code_detection', 
            'enhanced_ocr_text_extraction',
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
//beans
console.log('🚀 Arsenal Ticket Bot is now running!');
console.log('🤖 Bot username: @Arsenal_PK_bot');
console.log('👥 Configured admins:', config.ADMIN_IDS);
console.log('🔍 Enhanced features: QuaggaJS professional barcode scanning, JavaScript Barcode Reader fallback, jsQR detection, Enhanced OCR');
console.log('✨ Ready for enhanced ticket processing with professional barcode scanning!');