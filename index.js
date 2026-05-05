const express = require('express');
const path = require('path');
const pino = require('pino');
const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    delay, 
    makeCacheableSignalKeyStore 
} = require("@whiskeysockets/baileys");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

app.get('/code', async (req, res) => {
    let num = req.query.number;
    if (!num) return res.status(400).json({ error: "Number required" });

    const { state, saveCreds } = await useMultiFileAuthState(`./temp/${num}`);
    
    try {
        let Trustbit = makeWASocket({
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" })),
            },
            printQRInTerminal: false,
            logger: pino({ level: "fatal" }),
            browser: ["Ubuntu", "Chrome", "20.0.04"],
        });

        if (!Trustbit.authState.creds.registered) {
            await delay(1500);
            num = num.replace(/[^0-9]/g, '');
            const code = await Trustbit.requestPairingCode(num);
            if (!res.headersSent) {
                res.json({ code: code });
            }
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.listen(PORT, () => {
    console.log(`Trustbit MD Web running on port ${PORT}`);
});
