const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 10000;

// 🌍 API Anahtarları ve URL'ler
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const IKAS_API_TOKEN_URL = `https://adadunyaoptik.myikas.com/api/admin/oauth/token`;
const IKAS_API_GRAPHQL_URL = 'https://api.myikas.com/api/v1/admin/graphql';
const IKAS_CLIENT_ID = process.env.IKAS_CLIENT_ID;
const IKAS_CLIENT_SECRET = process.env.IKAS_CLIENT_SECRET;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ✅ **1. Webhook Doğrulama**
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

// ✅ **2. Gelen Mesajları İşleme**
app.post('/webhook', async (req, res) => {
    try {
        const entry = req.body.entry && req.body.entry[0];
        const change = entry && entry.changes && entry.changes[0];
        const messageData = change && change.value && change.value.messages && change.value.messages[0];

        if (messageData && messageData.from) {
            const from = messageData.from;
            const messageText = messageData.text ? messageData.text.body.toLowerCase() : "";
            const buttonId = messageData.button && messageData.button.payload;

            console.log(`📩 Yeni mesaj alındı: "${messageText}" (Gönderen: ${from})`);

            if (buttonId === "siparislerim" || messageText.includes("siparişlerim")) {
                const orders = await getOrdersByPhone(from);
                if (orders.includes("Telefon numaranıza ait sipariş bulunmamaktadır")) {
                    await sendWhatsAppMessage(from, orders); // Sipariş numarası iste
                } else {
                    await sendOrderList(from, orders); // Sipariş listesini gönder
                }
            } else if (buttonId && buttonId.startsWith("siparis_detay_")) {
                const orderNumber = buttonId.replace("siparis_detay_", "");
                const orderDetails = await getOrderDetails(orderNumber);
                await sendWhatsAppMessage(from, orderDetails); // Sipariş detaylarını gönder
            } else if (buttonId && buttonId.startsWith("kargo_takip_")) {
                const orderNumber = buttonId.replace("kargo_takip_", "");
                const trackingUrl = await getTrackingUrl(orderNumber);
                await sendWhatsAppMessage(from, `Kargo takip linkiniz: ${trackingUrl}`);
            } else if (messageText.includes("merhaba")) {
                await sendWhatsAppInteractiveMessage(from);
            } else {
                await sendWhatsAppMessage(from, `Merhaba! Size nasıl yardımcı olabilirim?`);
            }
        }

        res.sendStatus(200);
    } catch (error) {
        console.error("❌ Webhook işleme hatası:", error);
        res.sendStatus(500);
    }
});

// ✅ **3. Sipariş Listesi Gönderme (Her Siparişin Altında Buton)**
async function sendOrderList(to, orders) {
    let orderListMessage = "📦 **Siparişleriniz**:\n\n";
    orders.forEach((order, index) => {
        orderListMessage += `🆔 **Sipariş No:** ${order.orderNumber}\n`;
        orderListMessage += `🔹 **Durum:** ${translateStatus(order.status)}\n`;
        orderListMessage += `📅 **Sipariş Tarihi:** ${order.createdAt}\n\n`;
        orderListMessage += `🔍 Detayları görmek için butona basın:\n`;
        orderListMessage += `👉 [Sipariş Detayları](#siparis_detay_${order.orderNumber})\n\n`;
    });

    await sendWhatsAppMessage(to, orderListMessage);
}

// ✅ **4. Sipariş Detaylarını Getirme**
async function getOrderDetails(orderNumber) {
    const token = await getAccessToken();
    if (!token) {
        return "⚠️ Sipariş bilgilerinize ulaşılamıyor.";
    }

    const query = {
        query: `
        query {
            listOrder {
                data {
                    orderNumber
                    status
                    createdAt
                    totalFinalPrice
                    currencyCode
                    customer {
                        phone
                    }
                    orderLineItems {
                        finalPrice
                        quantity
                        variant {
                            name
                            mainImageId
                        }
                    }
                    shipping {
                        trackingUrl
                    }
                }
            }
        }`
    };

    try {
        const response = await axios.post(IKAS_API_GRAPHQL_URL, query, {
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            }
        });

        const orders = response.data.data.listOrder.data;
        const order = orders.find(order => order.orderNumber === orderNumber);

        if (!order) {
            return "⚠️ Sipariş bulunamadı.";
        }

        let orderDetails = `🆔 **Sipariş No:** ${order.orderNumber}\n`;
        orderDetails += `🔹 **Durum:** ${translateStatus(order.status)}\n`;
        orderDetails += `📅 **Sipariş Tarihi:** ${order.createdAt}\n`;
        orderDetails += `💰 **Toplam Fiyat:** ${order.totalFinalPrice} ${order.currencyCode}\n\n`;
        orderDetails += `📦 **Ürünler**:\n`;

        order.orderLineItems.forEach(item => {
            orderDetails += `📌 **Ürün:** ${item.variant.name}\n`;
            orderDetails += `🖼️ **Görsel:** https://cdn.myikas.com/${item.variant.mainImageId}\n`;
            orderDetails += `🔢 **Adet:** ${item.quantity}\n`;
            orderDetails += `💵 **Birim Fiyat:** ${item.finalPrice} ${order.currencyCode}\n\n`;
        });

        // Kargoya verildiyse kargo takip butonu ekle
        if (order.status === "SHIPPED" && order.shipping.trackingUrl) {
            orderDetails += `🚚 **Kargoyu Takip Et:** [Kargo Takip Linki](${order.shipping.trackingUrl})\n`;
        }

        return orderDetails;
    } catch (error) {
        console.error("❌ İKAS API hata:", error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        return "⚠️ Sipariş bilgilerinize ulaşırken hata oluştu.";
    }
}

// ✅ **5. Kargo Takip URL'sini Getirme**
async function getTrackingUrl(orderNumber) {
    const token = await getAccessToken();
    if (!token) {
        return "⚠️ Sipariş bilgilerinize ulaşılamıyor.";
    }

    const query = {
        query: `
        query {
            listOrder {
                data {
                    orderNumber
                    shipping {
                        trackingUrl
                    }
                }
            }
        }`
    };

    try {
        const response = await axios.post(IKAS_API_GRAPHQL_URL, query, {
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json"
            }
        });

        const orders = response.data.data.listOrder.data;
        const order = orders.find(order => order.orderNumber === orderNumber);

        if (!order || !order.shipping.trackingUrl) {
            return "⚠️ Kargo takip linki bulunamadı.";
        }

        return order.shipping.trackingUrl;
    } catch (error) {
        console.error("❌ İKAS API hata:", error.response ? JSON.stringify(error.response.data, null, 2) : error.message);
        return "⚠️ Kargo bilgilerinize ulaşırken hata oluştu.";
    }
}

// ✅ **6. Sipariş Durumlarını Türkçeye Çevir**
function translateStatus(status) {
    const statusMap = {
        "PENDING": "Beklemede",
        "PROCESSING": "Hazırlanıyor",
        "SHIPPED": "Kargoya Verildi",
        "DELIVERED": "Teslim Edildi",
        "CANCELLED": "İptal Edildi",
        "RETURNED": "İade Edildi",
        "FAILED": "Başarısız"
    };
    return statusMap[status] || status;
}

// **Sunucuyu Başlat**
app.listen(port, () => {
    console.log(`🚀 Sunucu ${port} portunda çalışıyor!`);
});