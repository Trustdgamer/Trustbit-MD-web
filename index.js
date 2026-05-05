const express = require('express');
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    makeCacheableSignalKeyStore,
    DisconnectReason
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

    // Fresh session folder every time to prevent "Couldn't Link"
    const sessionID = `Trustbit_${Math.random().toString(36).substring(7)}`;
    const authPath = path.join(__dirname, 'sessions', sessionID);
    await fs.ensureDir(authPath);
    
    const { state, saveCreds } = await useMultiFileAuthState(authPath);

    try {
        const Trustbit = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }),
            // Identity: Official Chrome on Windows (Most Trusted by WhatsApp)
            browser: ["Chrome (Windows)", "Chrome", "110.0.5481.178"],
            syncFullHistory: false,
            markOnlineOnConnect: true
        });

        // STABILIZER: Wait for the socket to build pre-keys
        Trustbit.ev.on('creds.update', saveCreds);

        // Give the server 5 seconds to "warm up" before requesting the code
        setTimeout(async () => {
            try {
                if (!Trustbit.authState.creds.registered) {
                    const code = await Trustbit.requestPairingCode(num);
                    if (!res.headersSent) {
                        res.json({ code: code });
                    }
                }
            } catch (pairErr) {
                console.error("Pairing Error:", pairErr);
                if (!res.headersSent) res.status(500).json({ error: "WhatsApp refused connection. Try again." });
            }
        }, 5000); 

        Trustbit.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                pairCount++;
                const credsData = await fs.readJson(path.join(authPath, 'creds.json'));
                const sessionIDBase64 = Buffer.from(JSON.stringify(credsData)).toString('base64');
                
                await Trustbit.sendMessage(Trustbit.user.id, { 
                    text: `*TRUSTBIT MD CONNECTED!* ✅\n\n*SESSION ID:*\n${sessionIDBase64}\n\nPaste this in your Panel.` 
                });
                
                // Cleanup
                setTimeout(() => { fs.remove(authPath).catch(() => {}); }, 10000);
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
        runtime: `${Math.floor(diff / 3600000)}h ${Math.floor((diff % 3600000) / 60000)}m`
    });
});

app.listen(PORT, () => console.log(`Trustbit Server Live`));
