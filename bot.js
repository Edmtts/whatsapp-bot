const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(bodyParser.json());

const VERIFY_TOKEN = "123456";  // Webhook doğrulama token’ı
const WHATSAPP_API_URL = "https://graph.facebook.com/v17.0";
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_ID;

// ✅ Webhook doğrulama
app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
        console.log("✅ Webhook doğrulandı!");
        res.status(200).send(challenge);
    } else {
        res.sendStatus(403);
    }
});

// 📩 WhatsApp'tan gelen mesajları işleme
app.post("/webhook", async (req, res) => {
    if (req.body.entry && req.body.entry[0].changes && req.body.entry[0].changes[0].value.messages) {
        const message = req.body.entry[0].changes[0].value.messages[0];
        const from = message.from;  // Gönderen numara
        const text = message.text.body.toLowerCase(); // Mesaj içeriği

        console.log(`📩 Yeni mesaj: ${text} (Gönderen: ${from})`);

        if (text === "merhaba") {
            await sendMessage(from, "Merhaba! Size nasıl yardımcı olabilirim?");
        } else {
            await sendMessage(from, "Üzgünüm, sizi anlayamadım. Lütfen bir komut girin.");
        }
    }

    res.sendStatus(200);
});

// 📤 WhatsApp'a mesaj gönderme fonksiyonu
async function sendMessage(to, message) {
    await axios.post(`${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`, {
        messaging_product: "whatsapp",
        to: to,
        text: { body: message }
    }, {
        headers: {
            Authorization: `Bearer ${ACCESS_TOKEN}`,
            "Content-Type": "application/json"
        }
    });
}

// 🌍 Sunucuyu başlat
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Sunucu ${PORT} portunda çalışıyor...`);
});
// Kullanıcının sipariş numarasını alıp İkas API’den sipariş bilgilerini getiren fonksiyon
async function getOrderStatus(orderId) {
    try {
        const response = await axios.post(process.env.IKAS_API_URL, {
            query: `
                query {
                    order(id: "${orderId}") {
                        id
                        status
                        trackingNumber
                        shippingCompany
                    }
                }
            `
        }, {
            headers: {
                "Content-Type": "application/json",
                "Client-Id": process.env.IKAS_CLIENT_ID,
                "Client-Secret": process.env.IKAS_CLIENT_SECRET
            }
        });

        return response.data.data.order;
    } catch (error) {
        console.error("❌ Sipariş sorgulama hatası:", error);
        return null;
    }
}

// Kullanıcı "Siparişimin Durumu" butonuna bastığında sipariş bilgilerini getirme
app.post("/webhook", async (req, res) => {
    if (req.body.entry && req.body.entry[0].changes && req.body.entry[0].changes[0].value.messages) {
        const message = req.body.entry[0].changes[0].value.messages[0];
        const from = message.from;
        const text = message.text?.body.toLowerCase();

        console.log(`📩 Yeni mesaj: ${text} (Gönderen: ${from})`);

        if (text === "siparişimin durumu") {
            await sendMessage(from, "Lütfen sipariş numaranızı girin:");
        } else if (/^\d+$/.test(text)) { // Eğer kullanıcı sadece rakam girdiyse sipariş numarası olduğunu varsayalım
            const order = await getOrderStatus(text);
            if (order) {
                await sendMessage(from, `📦 Sipariş Durumu: ${order.status}\n🚚 Kargo: ${order.shippingCompany}\n📦 Takip Numarası: ${order.trackingNumber}`);
            } else {
                await sendMessage(from, "❌ Üzgünüm, bu sipariş numarasıyla bir sipariş bulunamadı.");
            }
        }
    }

    res.sendStatus(200);
});

