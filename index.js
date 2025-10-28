const express = require('express');
const qrcodeTerminal = require('qrcode-terminal'); // For terminal logs
const qrcodeLib = require('qrcode'); // For generating web-friendly QR image
const { Client, LocalAuth } = require('whatsapp-web.js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Global variables
let qrCodeString = null; 
let client = null; // Initialize as null

// --- Simple Bot Logic Function (The Chatbot Engine) ---
// This function prepares the bot's response based on the incoming message.
function getBotResponse(message) {
    const text = message.toLowerCase().trim();

    if (text === 'hi' || text === 'hello') {
        return 'Hello! I am a general WhatsApp bot. Send me !help to see what I can do.';
    }
    if (text === '!status' || text.includes('online')) {
        return 'I am online and running on the Render server.';
    }
    if (text === '!time') {
        return `The current server time is: ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} (IST).`;
    }
    if (text.includes('thanks') || text.includes('thank you')) {
        return 'You\'re welcome! Happy to assist.';
    }
    if (text === '!help') {
        return '🤖 Available Commands:\n\n' +
                '- *Hi / Hello*: A friendly greeting.\n' +
                '- *!status*: Check if the bot is running.\n' +
                '- *!time*: Get the current server time.\n' +
                '- *!help*: Show this list.';
    }
    return "I received your message, but I only understand specific commands. Can you send *!help*?";
}
// --------------------------------------------------------


// --- Client Initialization and Event Listener Setup ---
function initializeWhatsAppClient() {
    console.log('--- Initializing/Re-initializing WhatsApp Client ---');
    
    // 1. Create a new client instance
    client = new Client({
        authStrategy: new LocalAuth({ clientId: "whatsapp-chatbot-id" }),
        // Increased timeouts to 120 seconds (2 minutes) for stability
        authTimeoutMs: 120000, 
        qrTimeoutMs: 120000,
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-video-decode',
                '--disable-gpu',
                '--unhandled-rejections=strict',
                // FIX: Added flags for improved stability and resource management in headless mode
                '--disable-web-security',
                '--disable-features=IsolateOrigins,site-per-process',
                '--incognito', 
                '--single-process', // Use single-process to reduce overhead
                '--no-zygote',
            ],
        },
    });

    // 2. Attach Listeners

    client.on('qr', (qr) => {
        // 1. Store the raw QR code string globally
        qrCodeString = qr; 
        
        // 2. Also generate QR in terminal/logs (for debugging)
        qrcodeTerminal.generate(qr, { small: true });
        console.log('--- QR RECEIVED ---');
        console.log('Scan the QR code via the /get-qr endpoint or the homepage (/).');
    });

    client.on('ready', () => {
        console.log('✅ Client is ready! WhatsApp session successfully established.');
        qrCodeString = null; // Clear the QR string after connection
    });

    client.on('auth_failure', (msg) => {
        console.error('❌ AUTHENTICATION FAILURE', msg);
        qrCodeString = null;
    });

    // --- FIX: Handle Disconnection/Logout gracefully with destruction and re-initialization ---
    client.on('disconnected', async (reason) => {
        console.log('🛑 Client Disconnected! Reason:', reason);
        qrCodeString = null; // Ensures the status correctly shows disconnected

        // CRITICAL FIX: Destroy the existing client to release the Chromium process and file locks (EBUSY fix)
        try {
            console.log('⏳ Attempting to gracefully destroy previous client instance to release file locks...');
            await client.destroy();
            console.log('✅ Previous client destroyed.');
        } catch (e) {
             // Log error but proceed, as the file lock might be the reason destroy failed
            console.error('⚠️ Error during client destruction (Expected EBUSY fix):', e.message);
        }

        // Re-initialize the client to force the generation of a new QR code.
        console.log('🔄 Re-initializing client to generate new QR code...');
        // Wait period to ensure resources are cleared before restarting Puppeteer
        await new Promise(resolve => setTimeout(resolve, 5000));
        initializeWhatsAppClient(); 
    });


    // --- Core Chatbot Logic (Accepts messages from all numbers) ---
    client.on('message', message => {
        if (message.fromMe || message.isStatus) return;

        if (message.body) {
            console.log(`[INCOMING] from ${message.from}: ${message.body}`);
            const botResponse = getBotResponse(message.body);
            client.sendMessage(message.from, botResponse);
        }
    });
    // ----------------------------------------
    
    // 3. Start the client process
    client.initialize();
}
// ------------------------------------------------------------------

// Start the WhatsApp client for the first time
initializeWhatsAppClient();


// --- 3. Express Server Routes (For Status, Health Check, and QR Code) ---

/**
 * 🏠 Home Route: Displays status and embeds the QR code image if authentication is needed.
 */
app.get('/', async (req, res) => {
    // Status check relies on client.info, which is cleared on disconnect
    let status = client && client.info ? `Ready (Connected as: ${client.info.pushname})` : 'Initializing/Waiting for QR Scan';
    let qrHtml = '';

    if (qrCodeString) {
        // Only generate QR HTML if the QR string is available
        try {
            // Generate the Base64 Data URL
            const qrImage = await qrcodeLib.toDataURL(qrCodeString);
            
            qrHtml = `
                <div style="margin: 20px auto; padding: 20px; border: 2px dashed #FF9800; max-width: 300px; text-align: center; border-radius: 10px; background-color: #fffaf0;">
                    <h2 style="color: #FF5722;">Scan to Connect</h2>
                    <img src="${qrImage}" alt="QR Code" style="width: 250px; height: 250px; border-radius: 5px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);">
                    <p style="color: #333; margin-top: 15px; font-weight: bold;">Session is not authenticated. Please scan the QR code using your phone's linked device feature.</p>
                </div>
            `;
            status = 'Waiting for QR Scan (Image Displayed)';
        } catch (error) {
            console.error('Error generating QR code Data URL for home page:', error);
            qrHtml = '<p style="color: red;">Error displaying QR code. Check logs.</p>';
        }
    }
    
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>WhatsApp Bot Status</title>
            <style>
                body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; text-align: center; padding-top: 20px; background-color: #e8f5e9; }
                .container { max-width: 600px; margin: 0 auto; background-color: white; padding: 30px; border-radius: 12px; box-shadow: 0 6px 20px rgba(0,0,0,0.15); }
                h1 { color: #128C7E; font-size: 2em; }
                .status-ready { color: #25D366; font-weight: bold; font-size: 1.2em; }
                .status-wait { color: #FF9800; font-weight: bold; font-size: 1.2em; }
                a { color: #128C7E; text-decoration: none; }
                a:hover { text-decoration: underline; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>WhatsApp Chatbot Status</h1>
                <p class="${client && client.info ? 'status-ready' : 'status-wait'}">Status: ${status}</p>
                
                ${qrHtml}
                
                <p style="margin-top: 30px; font-size: 0.9em; color: #666;"><b>⚠️ WARNING:</b> This service is using a non-persistent session. Re-authentication is required after every service restart.</p>
                <p style="font-size: 0.9em; color: #666;">Raw QR data is available here: <b><a href="/get-qr">/get-qr</a></b></p>
            </div>
        </body>
        </html>
    `);
});


/**
 * 📈 API Endpoint for Health Check and Raw QR Data
 * This is the dedicated API route that returns JSON data.
 */
app.get('/get-qr', async (req, res) => {
    if (client.info) {
        // Client is connected, no QR code needed
        return res.status(200).json({ status: 'connected', message: `Client is already connected as ${client.info.pushname}.` });
    }

    if (qrCodeString) {
        try {
            // Generate a Data URL (Base64 Image) from the QR string
            const qrImage = await qrcodeLib.toDataURL(qrCodeString);
            
            // Return the Data URL in the response (as JSON)
            return res.status(200).json({
                status: 'waiting_for_scan',
                qr_code_data_url: qrImage, // Use this in an <img> tag src=""
                qr_code_string: qrCodeString, // The raw string
                message: 'Scan the QR code to authenticate the WhatsApp session.'
            });
        } catch (error) {
            console.error('Error generating QR code Data URL:', error);
            return res.status(500).json({ status: 'error', message: 'Failed to generate QR image.' });
        }
    } else {
        return res.status(202).json({ status: 'initializing', message: 'WhatsApp client is initializing. Please wait a few seconds and try again.' });
    }
});

// Critical health check endpoint to keep the service awake
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
