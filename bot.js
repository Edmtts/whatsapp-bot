const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 10000;

// Ortam değişkenleri ve API URL'leri
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const IKAS_API_TOKEN_URL = `https://adadunyaoptik.myikas.com/api/admin/oauth/token`;
const IKAS_API_GRAPHQL_URL = 'https://api.myikas.com/api/v1/admin/graphql';
const IKAS_CLIENT_ID = process.env.IKAS_CLIENT_ID;
const IKAS_CLIENT_SECRET = process.env.IKAS_CLIENT_SECRET;

// Body-parser ayarları
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Kullanıcı state'lerini tutan obje
const userStates = {};

// Webhook GET: Doğrulama
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

// Webhook POST: Gelen mesajların işlenmesi
app.post('/webhook', async (req, res) => {
  try {
    const entry = req.body.entry && req.body.entry[0];
    const change = entry && entry.changes && entry.changes[0];
    const messageData = change && change.value && change.value.messages && change.value.messages[0];

    if (messageData && messageData.from) {
      const from = messageData.from;
      
      // Her kullanıcı için state oluşturuluyor
      if (!userStates[from]) {
        userStates[from] = { mainMenuShown: false, awaitingOrderNumber: false, currentOrder: null };
      }
      
      // Gelen mesajın tamamını loglayalım
      console.log("Gelen mesaj verisi:", JSON.stringify(messageData, null, 2));
      
      let buttonTitle = "";
      // Eğer buton yanıtı varsa, title değerini alıyoruz.
      if (messageData.button_reply && messageData.button_reply.title) {
        buttonTitle = messageData.button_reply.title.toLowerCase().trim();
      } else if (messageData.text && messageData.text.body) {
        buttonTitle = messageData.text.body.toLowerCase().trim();
      }
      
      console.log(`📩 Alınan buton title: "${buttonTitle}" (Gönderen: ${from})`);

      // Eğer sipariş numarası bekleniyorsa (kullanıcı sipariş numarası girecek)
      if (userStates[from].awaitingOrderNumber) {
        const orderNumber = buttonTitle; // Kullanıcının girdiği sipariş numarası
        const order = await getOrderByOrderNumber(orderNumber);
        if (order) {
          sendOrderInteractiveMessage(from, order);
          userStates[from].awaitingOrderNumber = false;
        } else {
          sendWhatsAppMessage(from, "Belirttiğiniz sipariş numarasına ait sipariş bulunamadı. Lütfen tekrar deneyiniz.");
        }
        return res.sendStatus(200);
      }

      // Ana menü henüz gösterilmediyse, ana menüyü gönder.
      if (!userStates[from].mainMenuShown) {
        sendWhatsAppInteractiveMessage(from);
        userStates[from].mainMenuShown = true;
        return res.sendStatus(200);
      }
      
      // Gelen buton title'sine göre yönlendirme yapalım
      if (buttonTitle === "siparişlerim") {
        const orders = await getOrdersByPhone(from);
        if (typeof orders === 'string' || orders.length === 0) {
          sendWhatsAppMessage(from, "Telefon numaranıza kayıtlı sipariş yok, sipariş numaranızı girerek kontrol sağlayabiliriz.");
          userStates[from].awaitingOrderNumber = true;
        } else {
          orders.forEach(order => {
            sendOrderInteractiveMessage(from, order);
          });
        }
      } else if (buttonTitle === "siparişim nerede?") {
        sendWhatsAppMessage(from, "Siparişinizin nerede olduğunu gösteren detaylı bilgi burada olacak.");
      } else if (buttonTitle === "iade ve iptal") {
        sendWhatsAppMessage(from, "İade ve iptal işlemleriyle ilgili bilgi burada olacak.");
      }
      // Dinamik sipariş detay menüsü (bu menüdeki butonlar; örn: kargo takip no, sipariş durumu, iade)
      else if (buttonTitle === "kargo takip no") {
        const orderNumber = userStates[from].currentOrder;
        if (orderNumber) {
          sendTrackingInfoMessage(from, orderNumber);
        } else {
          sendWhatsAppMessage(from, "Lütfen önce siparişinizi seçiniz.");
        }
      } else if (buttonTitle === "sipariş durumu") {
        const orderNumber = userStates[from].currentOrder;
        if (orderNumber) {
          sendOrderStatusMessage(from, orderNumber);
        } else {
          sendWhatsAppMessage(from, "Lütfen önce siparişinizi seçiniz.");
        }
      } else if (buttonTitle === "iade") {
        const orderNumber = userStates[from].currentOrder;
        if (orderNumber) {
          sendReturnConfirmationMessage(from, orderNumber);
        } else {
          sendWhatsAppMessage(from, "Lütfen önce siparişinizi seçiniz.");
        }
      }
      // İade onay menüsü butonları
      else if (buttonTitle === "onaylıyorum") {
        const orderNumber = userStates[from].currentOrder;
        if (orderNumber) {
          initiateReturnRequest(from, orderNumber);
        } else {
          sendWhatsAppMessage(from, "Sipariş bilgisi bulunamadı.");
        }
      } else if (buttonTitle === "vazgeç") {
        sendWhatsAppInteractiveMessage(from);
      } else if (buttonTitle === "başka bir sorum var") {
        sendCustomerServiceMessage(from);
      }
      // "Bu Siparişi İncele" butonundan gelen id üzerinden işlem (örneğin: "order_detail_1234")
      else if (buttonTitle.startsWith("bu siparişi incele")) {
        // Eğer bu buton seçilmişse, state'de saklı sipariş numarasını kullanıyoruz.
        const orderNumber = userStates[from].currentOrder;
        if (orderNumber) {
          sendOrderDetailInteractiveMenu(from, orderNumber);
        } else {
          sendWhatsAppMessage(from, "Sipariş bilgisi bulunamadı.");
        }
      } else {
        sendWhatsAppMessage(from, "Lütfen menüdeki butonlardan birini seçiniz.");
      }
    }
    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Webhook işleme hatası:", error);
    res.sendStatus(500);
  }
});

// Ana Menü: Butonlu mesaj gönderimi (buton title'ları kullanılarak)
async function sendWhatsAppInteractiveMessage(to) {
  const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
  const data = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "Merhaba! Size nasıl yardımcı olabilirim?" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "siparislerim", title: "Siparişlerim" } },
          { type: "reply", reply: { id: "siparisim_nerede", title: "Siparişim Nerede?" } },
          { type: "reply", reply: { id: "iade_iptal", title: "İade ve İptal" } }
        ]
      }
    }
  };
  try {
    const response = await axios.post(url, data, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" }
    });
    console.log("✅ Ana menü mesajı gönderildi:", response.data);
  } catch (error) {
    console.error("❌ Ana menü mesajı gönderme hatası:", error.response ? error.response.data : error.message);
  }
}

// IKAS API üzerinden Access Token alma
async function getAccessToken() {
  try {
    const response = await axios.post(
      IKAS_API_TOKEN_URL,
      `grant_type=client_credentials&client_id=${IKAS_CLIENT_ID}&client_secret=${IKAS_CLIENT_SECRET}`,
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    console.log("✅ Access Token alındı:", response.data.access_token);
    return response.data.access_token;
  } catch (error) {
    console.error("❌ Access Token alma hatası:", error.response ? error.response.data : error.message);
    return null;
  }
}

// Telefon numarasına göre siparişleri getiren GraphQL sorgusu
async function getOrdersByPhone(phone) {
  const token = await getAccessToken();
  if (!token) return "⚠️ Sipariş bilgilerinize ulaşılamıyor.";
  const normalizedPhone = "+90" + phone.replace(/\D/g, "").slice(-10);
  const query = {
    query: `
    query {
      listOrder {
        data {
          orderNumber
          status
          totalFinalPrice
          currencyCode
          createdAt
          customer {
            phone
          }
        }
      }
    }`
  };
  try {
    const response = await axios.post(IKAS_API_GRAPHQL_URL, query, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    });
    const orders = response.data.data.listOrder.data;
    const userOrders = orders.filter(order => order.customer && order.customer.phone === normalizedPhone);
    return userOrders;
  } catch (error) {
    console.error("❌ IKAS API hata:", error.response ? error.response.data : error.message);
    return "⚠️ Sipariş bilgilerinize ulaşırken hata oluştu.";
  }
}

// Sipariş numarasına göre siparişi getiren sorgu (tek sipariş)
async function getOrderByOrderNumber(orderNumber) {
  const token = await getAccessToken();
  if (!token) return null;
  const query = {
    query: `
    query ($orderNumber: String!) {
      order(orderNumber: $orderNumber) {
        orderNumber
        status
        totalFinalPrice
        currencyCode
        createdAt
        customer {
          phone
        }
      }
    }`,
    variables: { orderNumber }
  };
  try {
    const response = await axios.post(IKAS_API_GRAPHQL_URL, query, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
    });
    return response.data.data.order;
  } catch (error) {
    console.error("❌ IKAS API (order by orderNumber) hata:", error.response ? error.response.data : error.message);
    return null;
  }
}

// Her sipariş için interaktif mesaj gönderimi (sipariş detayı)
async function sendOrderInteractiveMessage(to, order) {
  const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
  const orderDate = order.createdAt ? new Date(order.createdAt).toLocaleDateString() : "Bilinmiyor";
  const status = order.status || "Bilinmiyor";
  const productName = "Ürün bilgisi yok"; // IKAS sorgusunda ürün bilgisi olmadığı için varsayılan
  const bodyText = `Sipariş No: ${order.orderNumber}\nSipariş Tarihi: ${orderDate}\nDurumu: ${status}\nÜrün: ${productName}\nFiyat: ${order.totalFinalPrice} ${order.currencyCode}`;
  
  // Seçilen sipariş numarasını state'e kaydediyoruz.
  userStates[to].currentOrder = order.orderNumber;
  
  const data = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to,
    type: "interactive",
    interactive: {
      type: "button",
      header: { type: "image", image: { link: "" } },
      body: { text: bodyText },
      action: {
        buttons: [
          { type: "reply", reply: { id: `order_detail_${order.orderNumber}`, title: "Bu Siparişi İncele" } }
        ]
      }
    }
  };
  try {
    const response = await axios.post(url, data, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" }
    });
    console.log(`✅ Sipariş ${order.orderNumber} için interaktif mesaj gönderildi:`, response.data);
  } catch (error) {
    console.error(`❌ Sipariş ${order.orderNumber} için interaktif mesaj gönderme hatası:`, error.response ? error.response.data : error.message);
  }
}

// Sipariş detay menüsü: "Bu siparişi hakkında ne yapmak istiyorsun?"
async function sendOrderDetailInteractiveMenu(to, orderNumber) {
  const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
  const data = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: "Bu siparişi hakkında ne yapmak istiyorsun?" },
      action: {
        buttons: [
          { type: "reply", reply: { id: "kargo_takip", title: "Kargo takip no" } },
          { type: "reply", reply: { id: "siparis_durumu", title: "Sipariş durumu" } },
          { type: "reply", reply: { id: "iade", title: "İade" } }
        ]
      }
    }
  };
  try {
    const response = await axios.post(url, data, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" }
    });
    console.log(`✅ Sipariş ${orderNumber} detay interaktif mesaj gönderildi:`, response.data);
  } catch (error) {
    console.error(`❌ Sipariş ${orderNumber} detay interaktif mesaj gönderme hatası:`, error.response ? error.response.data : error.message);
  }
}

// Kargo takip no: İlgili siparişin kargo takip bilgisini gösterir.
async function sendTrackingInfoMessage(to, orderNumber) {
  const trackingInfo = await getTrackingInfo(orderNumber);
  const baseMessage = `Sipariş ${orderNumber} nolu takip kodun üzerinden takip edebilirsin: ${trackingInfo.trackingCode}`;
  if (trackingInfo.delivered && trackingInfo.trackingUrl) {
    const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
    const data = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: baseMessage },
        action: {
          buttons: [
            { type: "url", url: { title: "Takip Et", url: trackingInfo.trackingUrl } }
          ]
        }
      }
    };
    try {
      const response = await axios.post(url, data, {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" }
      });
      console.log(`✅ Sipariş ${orderNumber} kargo takip kodu mesajı gönderildi:`, response.data);
    } catch (error) {
      console.error(`❌ Sipariş ${orderNumber} kargo takip kodu mesaj gönderme hatası:`, error.response ? error.response.data : error.message);
    }
  } else {
    sendWhatsAppMessage(to, baseMessage);
  }
}

// Sipariş durumu: "kargoda" bilgisi ve takip butonu
async function sendOrderStatusMessage(to, orderNumber) {
  const trackingInfo = await getTrackingInfo(orderNumber);
  const baseMessage = `Sipariş ${orderNumber} nolu ürün "kargoda" görünmektedir.\nKargo firması: ${trackingInfo.carrierName}, takip no: ${trackingInfo.trackingCode}`;
  if (trackingInfo.delivered && trackingInfo.trackingUrl) {
    const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
    const data = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: baseMessage },
        action: {
          buttons: [
            { type: "url", url: { title: "Takip Et", url: trackingInfo.trackingUrl } }
          ]
        }
      }
    };
    try {
      const response = await axios.post(url, data, {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" }
      });
      console.log(`✅ Sipariş ${orderNumber} durum bilgisi mesajı gönderildi:`, response.data);
    } catch (error) {
      console.error(`❌ Sipariş ${orderNumber} durum bilgisi mesaj gönderme hatası:`, error.response ? error.response.data : error.message);
    }
  } else {
    sendWhatsAppMessage(to, baseMessage);
  }
}

// İade: Sipariş "teslim edildi" ise onay mesajı gönder, aksi halde uyarı göster.
async function sendReturnConfirmationMessage(to, orderNumber) {
  const orderDetails = await getTrackingInfo(orderNumber);
  if (orderDetails.status !== "teslim edildi") {
    sendWhatsAppMessage(to, `Not: Sipariş ${orderNumber} nolu ürün "${orderDetails.status}" aşamasında olduğu için iade başlatılamaz. Teslim edildikten 14 gün içerisinde iade talebinde bulunabilirsiniz.`);
    return;
  }
  const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
  const data = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to,
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: `Sipariş ${orderNumber} nolu ürün için iade talebi oluşturduğunu onaylıyor musun?` },
      action: {
        buttons: [
          { type: "reply", reply: { id: "onaylıyorum", title: "Onaylıyorum" } },
          { type: "reply", reply: { id: "vazgeç", title: "Vazgeç" } },
          { type: "reply", reply: { id: "baska bir sorum var", title: "Başka bir sorum var" } }
        ]
      }
    }
  };
  try {
    const response = await axios.post(url, data, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" }
    });
    console.log(`✅ İade onay mesajı gönderildi for order ${orderNumber}:`, response.data);
  } catch (error) {
    console.error(`❌ İade onay mesajı gönderme hatası for order ${orderNumber}:`, error.response ? error.response.data : error.message);
  }
}

// İade Onay: API çağrısı simülasyonu
async function initiateReturnRequest(to, orderNumber) {
  console.log(`API üzerinden iade talebi başlatılıyor: Order ${orderNumber}`);
  sendWhatsAppMessage(to, `Sipariş ${orderNumber} nolu ürün için iade talebiniz oluşturulmuştur.`);
}

// Müşteri temsilcisine bağlanma mesajı
function sendCustomerServiceMessage(to) {
  sendWhatsAppMessage(to, "Müşteri temsilcisine bağlanılıyor... Lütfen bekleyiniz.");
}

// Düz metin mesajı gönderme
async function sendWhatsAppMessage(to, message) {
  const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
  const data = {
    messaging_product: "whatsapp",
    to: to,
    type: "text",
    text: { body: message }
  };
  try {
    const response = await axios.post(url, data, {
      headers: { Authorization: `Bearer ${ACCESS_TOKEN}`, "Content-Type": "application/json" }
    });
    console.log("✅ Mesaj gönderildi:", response.data);
  } catch (error) {
    console.error("❌ WhatsApp mesaj gönderme hatası:", error.response ? error.response.data : error.message);
  }
}

// Simülasyon fonksiyonu: Kargo takip bilgilerini döndürüyor
async function getTrackingInfo(orderNumber) {
  return {
    trackingCode: "ABC123",
    trackingUrl: "https://tracking.example.com/ABC123",
    delivered: true,
    carrierName: "XYZ Kargo",
    status: "teslim edildi" // veya "kargoda", "sipariş oluşturuldu", vb.
  };
}

app.listen(port, () => {
  console.log(`🚀 Sunucu ${port} portunda çalışıyor!`);
});
