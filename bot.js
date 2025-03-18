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
const IKAS_API_URL = process.env.IKAS_API_URL;
const IKAS_CLIENT_ID = process.env.IKAS_CLIENT_ID;
const IKAS_CLIENT_SECRET = process.env.IKAS_CLIENT_SECRET;

// ✅ 1️⃣ Webhook doğrulama
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

// 📩 2️⃣ WhatsApp'tan gelen mesajları işleme
app.post("/webhook", async (req, res) => {
    if (req.body.entry && req.body.entry[0].changes && req.body.entry[0].changes[0].value.messages) {
        const message = req.body.entry[0].changes[0].value.messages[0];
        const from = message.from;
        const text = message.text?.body.toLowerCase();

        console.log(`📩 Yeni mesaj: ${text} (Gönderen: ${from})`);

        if (text === "merhaba") {
            await sendMessage(from, "Size nasıl yardımcı olabilirim?", [
                { title: "Sipariş", id: "order" },
                { title: "Siparişim Nerede", id: "where_is_my_order" },
                { title: "İade / Değişim / İptal", id: "return" }
            ]);
        } else if (text === "siparişim nerede") {
            await sendMessage(from, "Siparişiniz ve kargonuz ile ilgili hangi işlemi yapmak istersiniz?", [
                { title: "Kargom Nerede", id: "where_is_cargo" },
                { title: "Siparişimin Durumu", id: "order_status" }
            ]);
        } else if (/^\d+$/.test(text)) { // Eğer sadece rakam girdiyse, sipariş numarası olduğunu varsayalım
            const order = await getOrderStatus(text);
            if (order) {
                await sendMessage(from, `📦 Sipariş Durumu: ${order.status}\n🚚 Kargo: ${order.shippingCompany}\n📦 Takip Numarası: ${order.trackingNumber}`);
            } else {
                await sendMessage(from, "❌ Üzgünüm, bu sipariş numarasıyla bir sipariş bulunamadı.");
            }
        } else {
            await sendMessage(from, "Üzgünüm, sizi anlayamadım. Lütfen bir seçenek seçin.");
        }
    }

    res.sendStatus(200);
});

// 📤 3️⃣ WhatsApp'a mesaj gönderme (Butonları destekleyen format)
async function sendMessage(to, message, buttons = []) {
    let data = {
        messaging_product: "whatsapp",
        to: to,
        type: "interactive",
        interactive: {
            type: "button",
            body: { text: message },
            action: {
                buttons: buttons.map((btn) => ({
                    type: "reply",
                    reply: { id: btn.id, title: btn.title }
                }))
            }
        }
    };

    await axios.post(`${WHATSAPP_API_URL}/${PHONE_NUMBER_ID}/messages`, data, {
        headers: {
            Authorization: `Bearer ${ACCESS_TOKEN}`,
            "Content-Type": "application/json"
        }
    });
}

// 🔍 4️⃣ Kullanıcının sipariş numarasını alıp İkas API’den sipariş bilgilerini getirme
async function getOrderStatus(orderId) {
    try {
        const response = await axios.post(IKAS_API_URL, {
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
                "Client-Id": IKAS_CLIENT_ID,
                "Client-Secret": IKAS_CLIENT_SECRET
            }
        });

        return response.data.data.order;
    } catch (error) {
        console.error("❌ Sipariş sorgulama hatası:", error);
        return null;
    }
}

// 🌍 5️⃣ Sunucuyu başlat
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`🚀 Sunucu ${PORT} portunda çalışıyor...`);
});
