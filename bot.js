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



app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 🚀 Webhook doğrulama
app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode && token === VERIFY_TOKEN) {
        console.log("✅ Webhook doğrulandı!");
        res.status(200).send(challenge);
    } else {
        console.error("❌ Webhook doğrulaması başarısız.");
        res.sendStatus(403);
    }
});

// 🚀 Gelen mesajları işleme
app.post("/webhook", async (req, res) => {
    try {
        const entry = req.body.entry && req.body.entry[0];
        const change = entry && entry.changes && entry.changes[0];
        const messageData = change && change.value && change.value.messages && change.value.messages[0];

        if (messageData && messageData.from) {
            const from = messageData.from;
            const messageText = messageData.text ? messageData.text.body : null;

            console.log(`📩 Yeni mesaj alındı: "${messageText}" (Gönderen: ${from})`);

            // Butonla ilgili yanıtlar
            if (messageData.type === "interactive" && messageData.interactive.type === "button_reply") {
                const buttonId = messageData.interactive.button_reply.id;

                if (buttonId === "siparisim") {
                    await getOrdersByPhone(from);
                } else if (buttonId === "siparis_durum") {
                    sendWhatsAppMessage(from, "Sipariş durumunuzu kontrol etmek için lütfen sipariş numaranızı girin.");
                } else if (buttonId === "iade_iptal") {
                    sendWhatsAppMessage(from, "İade veya iptal işlemleri için lütfen talebinizi açıklayın.");
                }
            } else {
                // Eğer herhangi bir buton yoksa kullanıcıya butonlu menü gönder
                await sendWhatsAppButtonMenu(from);
            }
        }

        res.sendStatus(200);
    } catch (error) {
        console.error("❌ Webhook işleme hatası:", error);
        res.sendStatus(500);
    }
});

// 🚀 WhatsApp'a butonlu menü gönderme
const sendWhatsAppButtonMenu = async (to) => {
    const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;

    const data = {
        messaging_product: "whatsapp",
        to: to,
        type: "interactive",
        interactive: {
            type: "button",
            body: {
                text: "📌 Lütfen bir işlem seçin:"
            },
            action: {
                buttons: [
                    { type: "reply", reply: { id: "siparisim", title: "📦 Siparişlerim" } },
                    { type: "reply", reply: { id: "siparis_durum", title: "🚚 Siparişim Nerede?" } },
                    { type: "reply", reply: { id: "iade_iptal", title: "🔄 İade ve İptal" } }
                ]
            }
        }
    };

    try {
        const response = await axios.post(url, data, {
            headers: {
                Authorization: `Bearer ${ACCESS_TOKEN}`,
                "Content-Type": "application/json"
            }
        });

        console.log("✅ Butonlu mesaj gönderildi:", response.data);
    } catch (error) {
        console.error("❌ Butonlu mesaj gönderme hatası:", error.response ? error.response.data : error.message);
    }
};

// 🚀 İKAS API’den telefon numarasına göre sipariş getirme
const getOrdersByPhone = async (whatsappNumber) => {
    const accessToken = await getAccessToken();
    if (!accessToken) {
        sendWhatsAppMessage(whatsappNumber, "⚠️ Sipariş bilgilerinize ulaşılamıyor.");
        return;
    }

    // +90XXXXXXXXXX formatına dönüştürme
    let formattedPhone = whatsappNumber.replace("+", "").replace(/\D/g, "");
    formattedPhone = "+90" + formattedPhone;

    console.log(`📞 İşlenen Telefon Numarası: ${formattedPhone}`);

    // Örnek bir GraphQL sorgusu
    const query = {
        query: `
        query {
            listOrder {
                data {
                    orderNumber
                    status
                    totalFinalPrice
                    currencyCode
                    customer {
                        phone
                    }
                }
            }
        }`
    };

    try {
        const response = await axios.post(`${IKAS_API_URL}/graphql`, query, {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json"
            }
        });

        const orders = response.data.data.listOrder.data;
        const userOrders = orders.filter(order => order.customer && order.customer.phone && order.customer.phone.includes(formattedPhone));

        if (userOrders.length === 0) {
            sendWhatsAppMessage(whatsappNumber, "📦 Telefon numaranıza ait sipariş bulunmamaktadır.");
            return;
        }

        let message = "📦 **Son Siparişleriniz:**\n\n";
        userOrders.forEach(order => {
            message += `📌 **Sipariş No:** ${order.orderNumber}\n🔹 **Durum:** ${order.status}\n💰 **Tutar:** ${order.totalFinalPrice} ${order.currencyCode}\n\n`;
        });

        sendWhatsAppMessage(whatsappNumber, message);
    } catch (error) {
        console.error("❌ İKAS API hata:", error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        sendWhatsAppMessage(whatsappNumber, "⚠️ Sipariş bilgilerinize ulaşırken hata oluştu.");
    }
};

// 🚀 İKAS API’den Access Token alma
const getAccessToken = async () => {
    try {
        const response = await axios.post(`${IKAS_API_URL}/oauth/token`, 
            `grant_type=client_credentials&client_id=${IKAS_CLIENT_ID}&client_secret=${IKAS_CLIENT_SECRET}`,
            { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
        );

        console.log("✅ Access Token Alındı:", response.data.access_token);
        return response.data.access_token;
    } catch (error) {
        console.error("❌ Access Token alma hatası:", error.response ? error.response.data : error.message);
        return null;
    }
};

// 🚀 WhatsApp'a düz metin mesaj gönderme
const sendWhatsAppMessage = async (to, message) => {
    const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;

    const data = {
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: { body: message }
    };

    try {
        const response = await axios.post(url, data, {
            headers: {
                Authorization: `Bearer ${ACCESS_TOKEN}`,
                "Content-Type": "application/json"
            }
        });

        console.log("✅ Mesaj gönderildi:", response.data);
    } catch (error) {
        console.error("❌ WhatsApp mesaj gönderme hatası:", error.response ? error.response.data : error.message);
    }
};

// 🚀 Sunucuyu başlat
app.listen(port, () => {
    console.log(`🚀 Sunucu ${port} portunda çalışıyor!`);
});
