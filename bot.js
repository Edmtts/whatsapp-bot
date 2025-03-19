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

// 📌 Kullanıcıların sipariş numarasını takip etmek için geçici bir hafıza (RAM tabanlı)
const userState = {};

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 🚀 1️⃣ Webhook Doğrulama
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

// 🚀 2️⃣ WhatsApp'tan Gelen Mesajları İşleme
app.post('/webhook', (req, res) => {
    try {
        console.log("📩 Gelen Webhook verisi:", JSON.stringify(req.body, null, 2));

        if (req.body.entry) {
            req.body.entry.forEach(entry => {
                entry.changes.forEach(change => {
                    if (change.field === "messages" && change.value.messages) {
                        change.value.messages.forEach(message => {
                            let from = message.from;
                            let text = message.text ? message.text.body.trim() : "";
                            console.log(`📩 Yeni mesaj alındı: ${text} (Gönderen: ${from})`);

                            // 📌 Eğer kullanıcı sipariş numarası giriyorsa, bunu al ve sorgula
                            if (userState[from] === "awaiting_order_number") {
                                userState[from] = null; // Kullanıcının durumunu sıfırla
                                getOrderById(from, text); // Siparişi getir
                                return;
                            }

                            // 📌 Butona basıldıysa
                            if (message.type === "interactive" && message.interactive.type === "button_reply") {
                                let button_id = message.interactive.button_reply.id;

                                if (button_id === "siparisim") {
                                    requestOrderNumber(from); // Sipariş numarasını sor
                                }
                            } else {
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

// 🚀 3️⃣ WhatsApp Butonlu Mesaj Gönderme
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
                text: "Merhaba! Size nasıl yardımcı olabilirim?"
            },
            body: {
                text: "Lütfen bir seçenek seçin:"
            },
            action: {
                buttons: [
                    { type: "reply", reply: { id: "siparisim", title: "📦 Siparişim" } },
                    { type: "reply", reply: { id: "siparisim_nerede", title: "🚚 Siparişim Nerede?" } },
                    { type: "reply", reply: { id: "iade_iptal", title: "🔄 İade ve İptal" } }
                ]
            }
        }
    };

    try {
        await axios.post(url, data, {
            headers: {
                Authorization: `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
    } catch (error) {
        console.error("❌ Butonlu mesaj gönderme hatası:", error.response ? error.response.data : error.message);
    }
};

// 🚀 4️⃣ Kullanıcıdan Sipariş Numarası İsteme
const requestOrderNumber = async (to) => {
    userState[to] = "awaiting_order_number"; // Kullanıcının sipariş numarası bekleme durumuna geçmesini sağla
    sendWhatsAppMessage(to, "📦 Lütfen sipariş numaranızı giriniz:");
};

// 🚀 5️⃣ İKAS API’den Sipariş Numarasına Göre Siparişi Getirme
const getOrderById = async (whatsappNumber, orderId) => {
    const url = IKAS_API_URL;

    const query = {
        query: `
        query GetOrderById {
            order(id: "${orderId}") {
                id
                status
                totalPrice {
                    amount
                    currency
                }
            }
        }`
    };

    try {
        console.log(`📡 İKAS API’ye sipariş sorgusu gönderiliyor: ${JSON.stringify(query, null, 2)}`);

        const response = await axios.post(url, query, {
            headers: {
                "Authorization": `Basic ${Buffer.from(`${IKAS_CLIENT_ID}:${IKAS_CLIENT_SECRET}`).toString("base64")}`,
                "Content-Type": "application/json"
            }
        });

        console.log(`📨 İKAS API Yanıtı: ${JSON.stringify(response.data, null, 2)}`);

        if (!response.data || !response.data.data || !response.data.data.order) {
            sendWhatsAppMessage(whatsappNumber, "⚠️ Girdiğiniz sipariş numarası bulunamadı. Lütfen doğru sipariş numarası giriniz.");
            return;
        }

        const order = response.data.data.order;
        let message = `📦 **Sipariş Bilgileri**\n📌 **Sipariş ID:** ${order.id}\n🔹 **Durum:** ${order.status}\n💰 **Tutar:** ${order.totalPrice.amount} ${order.totalPrice.currency}`;
        sendWhatsAppMessage(whatsappNumber, message);
    } catch (error) {
        console.error("❌ İKAS API hata:", error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        sendWhatsAppMessage(whatsappNumber, "⚠️ Sipariş bilgilerinize ulaşırken hata oluştu.");
    }
};

// 🚀 6️⃣ WhatsApp Düz Metin Mesaj Gönderme
const sendWhatsAppMessage = async (to, message) => {
    const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;

    const data = {
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: { body: message }
    };

    try {
        await axios.post(url, data, {
            headers: {
                Authorization: `Bearer ${ACCESS_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
    } catch (error) {
        console.error("❌ Mesaj gönderme hatası:", error.response ? error.response.data : error.message);
    }
};

// 🚀 7️⃣ Sunucuyu Başlat
app.listen(port, () => {
    console.log(`🚀 Sunucu ${port} portunda çalışıyor!`);
});