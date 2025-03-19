const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 10000;

// API Anahtarları
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const IKAS_API_URL = process.env.IKAS_API_URL;
const IKAS_CLIENT_ID = process.env.IKAS_CLIENT_ID;
const IKAS_CLIENT_SECRET = process.env.IKAS_CLIENT_SECRET;

const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 10000;

// API Anahtarları
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

app.use(bodyParser.json({ strict: false }));
app.use(bodyParser.urlencoded({ extended: true }));

// 🚀 Webhook doğrulama
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token === VERIFY_TOKEN) {
        console.log("✅ Webhook doğrulandı!");
        res.status(200).send(challenge);
    } else {
        console.error("❌ Webhook doğrulaması başarısız.");
        res.sendStatus(403);
    }
});

// 🚀 WhatsApp gelen mesajları yakalama
app.post('/webhook', (req, res) => {
    try {
        console.log("📩 Gelen Webhook verisi:", JSON.stringify(req.body, null, 2));

        if (req.body.entry) {
            req.body.entry.forEach(entry => {
                entry.changes.forEach(change => {
                    if (change.field === "messages" && change.value.messages) {
                        change.value.messages.forEach(message => {
                            let from = message.from;
                            let text = message.text ? message.text.body.toLowerCase() : "";

                            console.log(`📩 Yeni mesaj alındı: "${text}" (Gönderen: ${from})`);

                            // Eğer müşteri "merhaba" yazarsa, butonlu mesaj gönder
                            if (text === "merhaba") {
                                sendWhatsAppInteractiveMessage(from);
                            }
                        });
                    }
                });
            });
        }

        res.sendStatus(200);
    } catch (error) {
        console.error("❌ Webhook hata:", error);
        res.sendStatus(500);
    }
});

// 🚀 WhatsApp interaktif mesaj gönderme fonksiyonu
const sendWhatsAppInteractiveMessage = async (to) => {
    const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;

    const data = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to,
        type: "interactive",
        interactive: {
            type: "button",
            header: {
                type: "text",
                text: "Merhaba, sizlere yardımcı olabileceğim konuyu seçermisiniz?"
            },
            body: {
                text: "Lütfen bir seçenek seçin:"
            },
            action: {
                buttons: [
                    { type: "reply", reply: { id: "siparisim", title: "Siparişim" } },
                    { type: "reply", reply: { id: "siparisim_nerede", title: "Siparişim nerede?" } },
                    { type: "reply", reply: { id: "iade_iptal", title: "İade ve İptal" } }
                ]
            }
        }
    };

    try {
        const response = await axios.post(url, data, {
            headers: {
                Authorization: `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        console.log("✅ Butonlu mesaj gönderildi:", response.data);
    } catch (error) {
        console.error("❌ Butonlu mesaj gönderme hatası:", error.response ? error.response.data : error.message);
    }
};

// 🚀 Sunucuyu başlat
app.listen(port, () => {
    console.log(`🚀 Sunucu ${port} portunda çalışıyor!`);
});
