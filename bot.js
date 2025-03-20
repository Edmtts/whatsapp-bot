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

// Global kullanıcı durumlarını tutan obje
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
      // Mesaj metnini küçük harfe çeviriyoruz.
      const messageText = messageData.text ? messageData.text.body.toLowerCase() : "";
      console.log(`📩 Yeni mesaj alındı: "${messageText}" (Gönderen: ${from})`);

      // Eğer kullanıcı ilk mesajını gönderiyorsa ana menüyü göster.
      if (!userStates[from]) {
        sendWhatsAppInteractiveMessage(from);
        userStates[from] = true;
      } else {
        // Gelen mesaj ID'sine göre ilgili fonksiyonlar çağrılıyor.
        if (messageText.startsWith("order_detail_")) {
          // "Bu Siparişi İncele" butonuna basıldı
          const orderNumber = messageText.replace("order_detail_", "");
          sendOrderDetailInteractiveMenu(from, orderNumber);
        } else if (messageText.startsWith("kargo_takip_")) {
          // "Kargo takip no" butonuna basıldı
          const orderNumber = messageText.replace("kargo_takip_", "");
          sendTrackingInfoMessage(from, orderNumber);
        } else if (messageText.startsWith("siparis_durumu_")) {
          // "Sipariş durumu" butonuna basıldı
          const orderNumber = messageText.replace("siparis_durumu_", "");
          sendOrderStatusMessage(from, orderNumber);
        } else if (
          messageText.startsWith("iade_") &&
          !messageText.startsWith("iade_onay_") &&
          !messageText.startsWith("iade_vazgec_") &&
          !messageText.startsWith("musteri_temsilci_")
        ) {
          // İlk "İade" butonuna basıldı
          const orderNumber = messageText.replace("iade_", "");
          sendReturnConfirmationMessage(from, orderNumber);
        } else if (messageText.startsWith("iade_onay_")) {
          // "Onaylıyorum" butonuna basıldı: iade talebi başlatılıyor
          const orderNumber = messageText.replace("iade_onay_", "");
          initiateReturnRequest(from, orderNumber);
        } else if (messageText.startsWith("iade_vazgec_")) {
          // "Vazgeç" butonuna basıldı: ana menü yeniden gösteriliyor
          sendWhatsAppInteractiveMessage(from);
        } else if (messageText.startsWith("musteri_temsilci_")) {
          // "Başka bir sorum var" butonuna basıldı: müşteri temsilcisine yönlendiriliyor
          sendCustomerServiceMessage(from);
        } else if (messageText === "siparisim") {
          // "Siparişlerim" butonuna basıldı
          const orders = await getOrdersByPhone(from);
          if (typeof orders === 'string') {
            sendWhatsAppMessage(from, orders);
          } else {
            orders.forEach(order => {
              sendOrderInteractiveMessage(from, order);
            });
          }
        } else if (messageText === "siparisim_nerede") {
          sendWhatsAppMessage(from, "Siparişinizin nerede olduğunu gösteren detaylı bilgi burada olacak.");
        } else if (messageText === "iade_iptal") {
          sendWhatsAppMessage(from, "İade ve iptal işlemleriyle ilgili bilgi burada olacak.");
        } else {
          sendWhatsAppMessage(from, "Lütfen menüdeki butonlardan birini seçiniz.");
        }
      }
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Webhook işleme hatası:", error);
    res.sendStatus(500);
  }
});

// Ana menü: Butonlu mesaj gönderme
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
          { type: "reply", reply: { id: "siparisim", title: "📦 Siparişlerim" } },
          { type: "reply", reply: { id: "siparisim_nerede", title: "🚚 Siparişim Nerede?" } },
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
}

// İKAS API üzerinden Access Token alma
async function getAccessToken() {
  try {
    const response = await axios.post(IKAS_API_TOKEN_URL,
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
  if (!token) {
    return "⚠️ Sipariş bilgilerinize ulaşılamıyor.";
  }

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
          items {
            price
            product {
              name
              imageUrl
            }
          }
          customer {
            phone
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
    const userOrders = orders.filter(order => order.customer && order.customer.phone === normalizedPhone);

    if (userOrders.length === 0) {
      return "Telefon numaranıza ait sipariş bulunmamaktadır.";
    }

    return userOrders;
  } catch (error) {
    console.error("❌ İKAS API hata:", error.response ? error.response.data : error.message);
    return "⚠️ Sipariş bilgilerinize ulaşırken hata oluştu.";
  }
}

// Her sipariş için interaktif mesaj gönderimi
async function sendOrderInteractiveMessage(to, order) {
  const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;

  const orderDate = order.createdAt ? new Date(order.createdAt).toLocaleDateString() : "Bilinmiyor";
  const status = order.status || "Bilinmiyor";
  const product = order.items && order.items[0] ? order.items[0].product : null;
  const productName = product ? product.name : "Ürün bilgisi yok";
  const productPrice = order.items && order.items[0] ? order.items[0].price : order.totalFinalPrice;
  const currency = order.currencyCode || "";
  const imageUrl = product && product.imageUrl ? product.imageUrl : "";

  const bodyText = `Sipariş No: ${order.orderNumber}\nSipariş Tarihi: ${orderDate}\nDurumu: ${status}\nÜrün: ${productName}\nFiyat: ${productPrice} ${currency}`;

  const data = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: to,
    type: "interactive",
    interactive: {
      type: "button",
      header: {
        type: "image",
        image: {
          link: imageUrl
        }
      },
      body: {
        text: bodyText
      },
      action: {
        buttons: [
          {
            type: "reply",
            reply: {
              id: `order_detail_${order.orderNumber}`,
              title: "Bu Siparişi İncele"
            }
          }
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
      body: {
        text: "Bu siparişi hakkında ne yapmak istiyorsun?"
      },
      action: {
        buttons: [
          {
            type: "reply",
            reply: {
              id: `kargo_takip_${orderNumber}`,
              title: "Kargo takip no"
            }
          },
          {
            type: "reply",
            reply: {
              id: `siparis_durumu_${orderNumber}`,
              title: "Sipariş durumu"
            }
          },
          {
            type: "reply",
            reply: {
              id: `iade_${orderNumber}`,
              title: "İade"
            }
          }
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
    console.log(`✅ Sipariş ${orderNumber} detay interaktif mesaj gönderildi:`, response.data);
  } catch (error) {
    console.error(`❌ Sipariş ${orderNumber} detay interaktif mesaj gönderme hatası:`, error.response ? error.response.data : error.message);
  }
}

// Kargo takip no: ilgili siparişin kargo takip bilgisini gösterir
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
        body: {
          text: baseMessage
        },
        action: {
          buttons: [
            {
              type: "url",
              url: {
                title: "Takip Et",
                url: trackingInfo.trackingUrl
              }
            }
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
      console.log(`✅ Sipariş ${orderNumber} kargo takip kodu mesajı gönderildi:`, response.data);
    } catch (error) {
      console.error(`❌ Sipariş ${orderNumber} kargo takip kodu mesaj gönderme hatası:`, error.response ? error.response.data : error.message);
    }
  } else {
    sendWhatsAppMessage(to, baseMessage);
  }
}

// Sipariş durumu: "kargoda" olduğuna dair bilgi ve takip butonu
async function sendOrderStatusMessage(to, orderNumber) {
  const trackingInfo = await getTrackingInfo(orderNumber);
  const baseMessage = `Sipariş ${orderNumber} nolu ürünün "kargoda" görünmektedir.\nDilersen aşağıdaki kargo takip no üzerinden takip edebilirsin.\nKargo firması: ${trackingInfo.carrierName}, takip no: ${trackingInfo.trackingCode}`;
  
  if (trackingInfo.delivered && trackingInfo.trackingUrl) {
    const url = `https://graph.facebook.com/v17.0/${PHONE_NUMBER_ID}/messages`;
    const data = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to,
      type: "interactive",
      interactive: {
        type: "button",
        body: {
          text: baseMessage
        },
        action: {
          buttons: [
            {
              type: "url",
              url: {
                title: "Takip Et",
                url: trackingInfo.trackingUrl
              }
            }
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
      console.log(`✅ Sipariş ${orderNumber} durum bilgisi mesajı gönderildi:`, response.data);
    } catch (error) {
      console.error(`❌ Sipariş ${orderNumber} durum bilgisi mesaj gönderme hatası:`, error.response ? error.response.data : error.message);
    }
  } else {
    sendWhatsAppMessage(to, baseMessage);
  }
}

// İade: Eğer sipariş "teslim edildi" ise onay mesajı gönder, aksi halde uyarı göster.
async function sendReturnConfirmationMessage(to, orderNumber) {
  const orderDetails = await getTrackingInfo(orderNumber);
  if (orderDetails.status !== "teslim edildi") {
    sendWhatsAppMessage(
      to, 
      `Not: Sipariş ${orderNumber} nolu ürünün "${orderDetails.status}" aşamasında olduğu için iade başlatamıyoruz. Teslim edildikten 14 gün içerisinde iade talebini başlatabilirsin.`
    );
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
      body: {
        text: `Sipariş ${orderNumber} nolu ürünün iade talebi oluşturduğuna emin misin?`
      },
      action: {
        buttons: [
          {
            type: "reply",
            reply: {
              id: `iade_onay_${orderNumber}`,
              title: "Onaylıyorum"
            }
          },
          {
            type: "reply",
            reply: {
              id: `iade_vazgec_${orderNumber}`,
              title: "Vazgeç"
            }
          },
          {
            type: "reply",
            reply: {
              id: `musteri_temsilci_${orderNumber}`,
              title: "Başka bir sorum var"
            }
          }
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
    console.log(`✅ İade onay mesajı gönderildi for order ${orderNumber}:`, response.data);
  } catch (error) {
    console.error(`❌ İade onay mesajı gönderme hatası for order ${orderNumber}:`, error.response ? error.response.data : error.message);
  }
}

// İade Onay: API üzerinden iade talebi başlatılıyor (simülasyon)
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
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      }
    });
    console.log("✅ Mesaj gönderildi:", response.data);
  } catch (error) {
    console.error("❌ WhatsApp mesaj gönderme hatası:", error.response ? error.response.data : error.message);
  }
}

// Kargo takip, sipariş durumu gibi bilgileri döndüren simülasyon fonksiyonu.
// Gerçek uygulamada, bu bilgileri API veya veritabanından almanız gerekecektir.
async function getTrackingInfo(orderNumber) {
  // Örnek veriler:
  return {
    trackingCode: "ABC123",
    trackingUrl: "https://tracking.example.com/ABC123",
    delivered: true,            // true ise "teslim edildi"
    carrierName: "XYZ Kargo",
    status: "teslim edildi"      // veya "kargoda", "sipariş oluşturuldu", vb.
  };
}

app.listen(port, () => {
  console.log(`🚀 Sunucu ${port} portunda çalışıyor!`);
});
