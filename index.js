const express = require('express');
const qrcodeTerminal = require('qrcode-terminal'); // For logs
const qrcodeLib = require('qrcode'); // For generating web-friendly QR image (Data URL)
const { Client, LocalAuth } = require('whatsapp-web.js');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Global variable to store QR code string temporarily
let qrCodeString = null; 
let client;

// --- Simple Bot Logic Function (The Chatbot Engine) ---
function getBotResponse(message) {
    const text = message.toLowerCase().trim();

    if (text === 'hi' || text === 'hello') {
        return 'Hello there! Send me !help to see what I can do. (Reply from Render bot)';
    }
    // ... (rest of your bot logic remains the same)
    if (text === '!status' || text.includes('online')) {
        return 'I am online and running on the Render server (non-persistent session).';
    }
    if (text === '!time') {
        return `The current server time is ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })} (IST).`;
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
    return "I received your message, but I only understand specific commands. Send *!help* to see what I can do.";
}
// --------------------------------------------------------

// --- 1. Client Initialization with Enhanced Robustness and Timeouts ---
client = new Client({
    authStrategy: new LocalAuth({ clientId: "whatsapp-chatbot-id" }),
    // Added robust settings to fix potential ERR_TIMED_OUT issue
    authTimeoutMs: 60000, 
    qrTimeoutMs: 30000,
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-video-decode',
            '--disable-gpu',
            '--unhandled-rejections=strict',
        ],
    },
});

// --- 2. WhatsApp Client Listeners ---

client.on('qr', (qr) => {
    // 1. Store the raw QR code string globally
    qrCodeString = qr; 
    
    // 2. Also generate QR in terminal/logs (for debugging)
    qrcodeTerminal.generate(qr, { small: true });
    console.log('--- QR RECEIVED ---');
    console.log('SCAN CODE via /get-qr endpoint or check logs.');
});

client.on('ready', () => {
    console.log('✅ Client is ready! WhatsApp session established.');
    qrCodeString = null; // Clear the QR string once connected
});

client.on('auth_failure', (msg) => {
    console.error('❌ AUTHENTICATION FAILURE', msg);
    qrCodeString = null;
});

// --- CORE CHATBOT LOGIC IMPLEMENTATION ---
client.on('message', message => {
    if (message.fromMe || message.isStatus) return;

    if (message.body) {
        console.log(`[INCOMING] from ${message.from}: ${message.body}`);
        const botResponse = getBotResponse(message.body);
        client.sendMessage(message.from, botResponse);
    }
});
// ----------------------------------------

client.initialize();


// --- 3. Express Server Routes (For Status, Health Check, and QR Code) ---

/**
 * 🚀 New Endpoint to get the QR code as a Data URL (Image) or String.
 * This is useful for displaying the QR on a web page or mobile app.
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
            
            // Send the Data URL in the response
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

app.get('/', (req, res) => {
    let status = client && client.info ? `Ready (Connected as ${client.info.pushname})` : 'Initializing/Waiting for QR Scan';
    res.send(`
        <h1>WhatsApp Chatbot Status: ${status}</h1>
        <p><b>⚠️ WARNING:</b> This service is using a non-persistent session. You must authenticate after every service restart.</p>
        <p>Check the logs or use the API endpoint: <b><a href="/get-qr">/get-qr</a></b></p>
    `);
});



app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});