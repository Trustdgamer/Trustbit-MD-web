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

    const sessionID = `temp_${Date.now()}`;
    const authPath = path.join(__dirname, 'sessions', sessionID);
    const { state, saveCreds } = await useMultiFileAuthState(authPath);
    const { version } = await fetchLatestBaileysVersion();

    try {
        const client = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
            },
            browser: Browsers.ubuntu("Chrome")
        });

        if (!client.authState.creds.registered) {
            setTimeout(async () => {
                try {
                    let code = await client.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join("-") || code;
                    if (!res.headersSent) res.json({ code: code });
                } catch (err) {
                    if (!res.headersSent) res.status(500).json({ error: "Pairing failed" });
                }
            }, 3000);
        }

        client.ev.on('creds.update', saveCreds);
        client.ev.on('connection.update', async (update) => {
            const { connection } = update;
            if (connection === 'open') {
                pairCount++;
                // Generate Base64 Session
                const credsData = fs.readFileSync(path.join(authPath, 'creds.json'));
                const base64Session = Buffer.from(credsData).toString('base64');
                
                await client.sendMessage(client.user.id, { 
                    text: `*TRUSTBIT MD SESSION ID*\n\n${base64Session}\n\nPaste this in your Panel variables.` 
                });
                
                // Cleanup
                setTimeout(() => { fs.removeSync(authPath); }, 5000);
            }
        });
    } catch (e) {
        if (!res.headersSent) res.status(500).json({ error: "Server Error" });
    }
});

app.get('/admin-data', (req, res) => {
    const diff = Date.now() - startTime;
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    res.json({
        slots: `${pairCount}/100`,
        visits: visitCount,
        time: moment().tz("Africa/Lagos").format("HH:mm:ss"),
        runtime: `${hours}h ${mins}m`
    });
});

app.listen(PORT, () => console.log(`Trustbit Web Live on ${PORT}`));
