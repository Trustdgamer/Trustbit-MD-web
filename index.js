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

// Variable to track start time for runtime
const startTime = Date.now();

app.get('/code', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: "Number required" });
    num = num.replace(/[^0-9]/g, '');

    // Vercel only allows writing to /tmp folder
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
            // Wait 3 seconds for stabilization
            await new Promise(resolve => setTimeout(resolve, 3000));
            const code = await Trustbit.requestPairingCode(num);
            
            if (!res.headersSent) {
                res.json({ code: code });
            }
        }

        Trustbit.ev.on('creds.update', saveCreds);
        
        Trustbit.ev.on('connection.update', async (update) => {
            if (update.connection === 'open') {
                const credsData = fs.readFileSync(path.join(authPath, 'creds.json'));
                const sessionID = Buffer.from(credsData).toString('base64');
                
                await Trustbit.sendMessage(Trustbit.user.id, { 
                    text: `*TRUSTBIT MD SESSION ID*\n\n${sessionID}\n\nPaste this in your Panel.` 
                });
                
                fs.removeSync(authPath);
                Trustbit.end();
            }
        });

    } catch (e) {
        if (!res.headersSent) res.status(500).json({ error: "WA Error" });
    }
});

app.get('/admin-data', (req, res) => {
    const diff = Date.now() - startTime;
    res.json({
        time: moment().tz("Africa/Lagos").format("HH:mm:ss"),
        runtime: `${Math.floor(diff/3600000)}h ${Math.floor((diff%3600000)/60000)}m`
    });
});

module.exports = app;
