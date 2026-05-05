const express = require('express');
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore 
} = require("@whiskeysockets/baileys");
const pino = require('pino');
const fs = require('fs-extra');
const path = require('path');
const moment = require('moment-timezone');

const app = express();

app.get('/api/code', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: "Number required" });
    num = num.replace(/[^0-9]/g, '');

    // Vercel only allows writing to /tmp
    const authPath = path.join('/tmp', `session_${num}`);
    if (fs.existsSync(authPath)) fs.removeSync(authPath);

    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    const { version } = await fetchLatestBaileysVersion();

    try {
        const Trustbit = makeWASocket({
            version,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }),
            browser: ["Mac OS", "Chrome", "110.0.5481.178"]
        });

        if (!Trustbit.authState.creds.registered) {
            // Short 3s delay to stabilize
            await new Promise(resolve => setTimeout(resolve, 3000));
            const code = await Trustbit.requestPairingCode(num);
            
            // Send code to UI immediately
            res.json({ code: code });
        }

        Trustbit.ev.on('creds.update', saveCreds);
        Trustbit.ev.on('connection.update', async (update) => {
            if (update.connection === 'open') {
                const credsData = fs.readFileSync(path.join(authPath, 'creds.json'));
                const sessionID = Buffer.from(credsData).toString('base64');
                
                await Trustbit.sendMessage(Trustbit.user.id, { 
                    text: `*TRUSTBIT MD SESSION ID*\n\n${sessionID}\n\nPaste this in your Panel.` 
                });
                
                // Cleanup
                fs.removeSync(authPath);
                Trustbit.end();
            }
        });

    } catch (e) {
        if (!res.headersSent) res.status(500).json({ error: "Try again" });
    }
});

// Admin stats endpoint
app.get('/api/admin', (req, res) => {
    res.json({
        time: moment().tz("Africa/Lagos").format("HH:mm:ss"),
        status: "Online",
        slots: "Active (100 Limit)"
    });
});

module.exports = app;
