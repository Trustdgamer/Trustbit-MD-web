const express = require('express');
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    makeCacheableSignalKeyStore 
} = require("@whiskeysockets/baileys");
const pino = require('pino');
const fs = require('fs');
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
    
    visitCount++;
    num = num.replace(/[^0-9]/g, '');

    // Create unique temp directory
    const authPath = `./temp/${num}_${Date.now()}`;
    if (!fs.existsSync('./temp')) fs.mkdirSync('./temp');

    const { state, saveCreds } = await useMultiFileAuthState(authPath);

    try {
        let client = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }),
            browser: ["Ubuntu", "Chrome", "20.0.04"],
        });

        // If not registered, request the code
        if (!client.authState.creds.registered) {
            await delay(3000); // Give it time to initialize
            const code = await client.requestPairingCode(num);
            
            if (!res.headersSent) {
                res.json({ code: code }); // Send the 8-digit code
            }
        }

        client.ev.on('creds.update', saveCreds);

        client.ev.on('connection.update', async (s) => {
            if (s.connection === 'open') {
                pairCount++;
                const authFile = JSON.parse(fs.readFileSync(`${authPath}/creds.json`));
                const sessionID = Buffer.from(JSON.stringify(authFile)).toString('base64');
                
                await client.sendMessage(client.user.id, { 
                    text: `*TRUSTBIT MD SESSION ID*\n\n${sessionID}\n\nCopy this and put it in your Panel.` 
                });
                
                // Cleanup
                setTimeout(() => { 
                    try { fs.rmSync(authPath, { recursive: true, force: true }); } catch (e) {}
                }, 5000);
            }
        });

    } catch (e) {
        console.error("Pairing Error:", e);
        if (!res.headersSent) res.status(500).json({ error: "Service timed out. Try again." });
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

app.listen(PORT, () => console.log(`Trustbit Website Live on ${PORT}`));
