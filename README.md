# RuneLab Benchmark Workspace

Chatbot değerlendirmelerini hazırlamak ve farklı akışların sonuçlarını karşılaştırmak için küçük bir araç ve fixture deposu.

## Kapsam

- Yanıt kalitesi ve yönlendirme davranışını değerlendirme
- Araç seçimi, onay adımları ve dinamik durumlar için kontrollü test örnekleri
- İnceleme ve karşılaştırma için kontrollü benchmark örnekleri hazırlama

## Depo içeriği

- `scripts/`: benchmark hazırlama ve test verisi araçları
- `eval/adversarial.jsonl`, `eval/tool-cases.jsonl`: paylaşıma uygun test şablonları
- `config.example.json`: yerel yapılandırma biçimi; değerler yerelde sağlanmalıdır

## Güvenli kullanım

- Yalnızca sentetik veya paylaşımı açıkça onaylanmış, anonimleştirilmiş veriler kullanın.
- Kimlik bilgilerini, bağlantı URI'lerini, şirket/müşteri kimliklerini, konuşma dökümlerini, özel ağ adreslerini veya üretilmiş hassas çıktıları repoya eklemeyin.
- Kaynak veriye erişirken en az yetkili, salt okunur bağlantı kullanın; yazma işlemlerini izole test ortamıyla sınırlandırın.
- Kimlik bilgilerini ortam değişkenlerinde veya bir secret manager'da tutun. `.env` dosyalarını commit etmeyin.
- Harici bir değerlendirme aracına veri göndermeden önce alıcıyı, saklama koşullarını ve paylaşım onayını kontrol edin; yalnızca gerekli ve onaylı örnekleri gönderin.
- Scriptleri çalıştırmadan önce kaynak ve hedef ortamı doğrulayın; her çalıştırmada üretilen dosyaları paylaşmadan önce gözden geçirin.

## Yerel hazırlık

Bağımlılıkları yükleyin:

```bash
npm install
```

Bu depoda bağlantı URI'si, parola veya erişim anahtarı bulunmamalıdır. Scriptler dış sistemlerden veri okuyabilir veya test hedefinde değişiklik yapabilir; çalıştırmadan önce kodu, kaynağı ve hedefi inceleyin. Hassas değerleri dosyalara veya çıktılara yazmayın.

## Durum

Bu araçlar kontrollü değerlendirme ve prototipleme içindir. Gerçek kullanıcı verisiyle veya üretim sistemlerinde kullanım için ayrıca güvenlik, yetkilendirme ve veri paylaşımı incelemesi gerekir.
