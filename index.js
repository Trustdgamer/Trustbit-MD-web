const express = require('express');
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    Browsers, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore 
} = require("@whiskeysockets/baileys");
const pino = require('pino');
const fs = require('fs-extra');
const path = require('path');
const moment = require('moment-timezone');

const app = express();
const PORT = process.env.PORT || 3000;

let pairCount = 0;
let visitCount = 0;
const startTime = Date.now();

app.use(express.static('public'));

app.get('/code', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: "Number required" });
    
    num = num.replace(/[^0-9]/g, '');
    visitCount++;

    // 1. CLEAR OLD SESSIONS FIRST (Fixes "Couldn't Link")
    const authPath = path.join(__dirname, 'session_' + num);
    if (fs.existsSync(authPath)) fs.removeSync(authPath);

    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    const { version } = await fetchLatestBaileysVersion();

    try {
        const devtrust = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
            },
            browser: Browsers.ubuntu("Chrome")
        });

        // 2. PAIRING LOGIC FROM YOUR FILE
        if (!devtrust.authState.creds.registered) {
            setTimeout(async () => {
                try {
                    let code = await devtrust.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join("-") || code;
                    
                    if (!res.headersSent) {
                        res.json({ code: code });
                    }
                } catch (err) {
                    console.log("Error getting code:", err.message);
                    if (!res.headersSent) res.status(500).json({ error: "WA Busy. Try again." });
                }
            }, 3000);
        }

        devtrust.ev.on('creds.update', saveCreds);
        
        devtrust.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                pairCount++;
                const credsData = fs.readFileSync(path.join(authPath, 'creds.json'));
                const sessionID = Buffer.from(credsData).toString('base64');
                
                await devtrust.sendMessage(devtrust.user.id, { 
                    text: `*TRUSTBIT MD SESSION ID*\n\n${sessionID}\n\nCopy this to your Panel.` 
                });
                
                setTimeout(() => { fs.removeSync(authPath); }, 5000);
            }
        });

    } catch (e) {
        if (!res.headersSent) res.status(500).json({ error: "Internal Server Error" });
    }
});

app.get('/admin-data', (req, res) => {
    const diff = Date.now() - startTime;
    res.json({
        slots: `${pairCount}/100`,
        visits: visitCount,
        time: moment().tz("Africa/Lagos").format("HH:mm:ss"),
        runtime: `${Math.floor(diff/3600000)}h ${Math.floor((diff%3600000)/60000)}m`
    });
});

app.listen(PORT, () => console.log(`Trustbit Web Active`));
