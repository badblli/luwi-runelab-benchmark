# RuneLab Benchmark Workspace

Bu klasor, Luwi chatbot icin RuneLab egitiminde kullanilacak benchmark paketini
hazirlamak icindir.

## Guvenlik kurallari

- Production veritabanina sadece read-only baglanilir.
- Production company veya conversation kaydi degistirilmez.
- Ham production export'u bu klasore yazilmaz.
- PII alanlari exporter tarafindan maskelenir.
- `hidden-test.jsonl` RuneLab'a gonderilmez; kurum icinde tutulur.

## V1 ve V3 kapsami

- V1: `conversations.history` icindeki legacy model kategorileri ve cevaplar.
- V3: agent, company knowledge, file-search/RAG ve tool/routing beklentileri.
- Ortak benchmark case'i iki akista da ayni kullanici mesaji ile kosulur; akis
  sonucu ve latency ayri raporlanir.

## Hazirlama

1. `config.example.json` dosyasini `config.json` olarak kopyalayin.
2. `companyId` alanina benchmark icin secilecek production company id'sini yazin.
3. Repo kokunde `.env.production` ve gerekirse `.env.production.local` mevcutken
   veya `PROD_DB_URI` ortami tanimli iken:

   `node scripts/export-prod-benchmark.mjs --config C:\\Users\\Lenovo\\Documents\\dev\\runelab-benchmark\\config.json --dry-run`

4. Dry-run raporu incelendikten sonra anonimlestirilmis export icin `--write` kullanin.

Tum test company'lerindeki bilgi, dynamic ve conversation orneklerini tek bir
evaluation paketi olarak almak icin `config.all.json` kullanilabilir. Her kayit
`source_company_id` ve `source_company_name` ile etiketlenir; company'ler arasi
beklenen cevaplar karistirilmaz.

Test DB icinde RuneLab'in baglanacagi tek company clone'unu olusturmak icin:

`node scripts/clone-all-to-test-company.mjs --dry-run`

Dry-run kontrolunden sonra:

`node scripts/clone-all-to-test-company.mjs --apply`

Kaynak `PROD_DB_URI` read-only okunur, hedef `TEST_DB_URI` yazilir. URI'ler bu
repoda tutulmaz.

## RuneLab'a verilecek bilgiler

Public repo benchmark kodu ve test company referansini icerir; panel icin
tester'larin ayni LAN/VPN agina erisimi olmalidir. Panel backend'i su an local
test DB'ye bagli olarak calisir.

Panel erisimi:

- Dashboard: `http://10.212.134.200:8081/`
- Alternatif LAN adresi: `http://192.168.10.114:8081/`
- Swagger/API: `http://10.212.134.200:8081/docs`
- Panel kullanici adi: `runelab`
- Panel sifresi: Public repo'ya yazilmaz; RuneLab'a ayri guvenli kanaldan verilir.

RuneLab'a ayri ve guvenli kanaldan sunulmasi gerekenler:

- Bu repo linki
- Panel sifresi
- Gerekirse test DB URI'si (`TEST_DB_URI`); production URI'si verilmemeli

Test company ve API bilgileri:

- Test DB adi: `test`
- Benchmark company ID: `b7e3c0f4-9d8a-4e91-a4f3-7c2d8e6b1a55`
- Backend API base URL: `http://10.212.134.200:8081`
- Alternatif backend API base URL: `http://192.168.10.114:8081`

RuneLab'in dogrudan MongoDB'ye baglanmasi gerekmez; panel ve API testleri
backend uzerinden yapilmalidir. API key, OpenAI Project bilgisi ve production
URI'si bu public repoya konulmaz.

Chat testleri icin company ID header olarak gonderilir:

```text
globalcompanyid: b7e3c0f4-9d8a-4e91-a4f3-7c2d8e6b1a55
```

V1 endpoint: `POST /api/chat`

V3 endpoint: `POST /api/chatv3` veya dogrudan mount edilmis `POST /chatv3`

Ornek body:

```json
{
  "message": "Odama havlu gönderebilir misiniz?",
  "customerInfo": {
    "CustomerID": "eval-customer-001",
    "CustomerName": "Evaluation Guest",
    "RoomNumber": "101",
    "Language": "TR"
  }
}
```

RuneLab once `benchmark.jsonl` case'lerini V1 ve V3'te calistirmali; routing,
cevap, dynamic state, confirmation, webhook ve tool sonucunu kaydetmeli.
`hidden-test.jsonl` RuneLab'a verilmemeli.

Public repo kullaniminda `npm install` sonrasi `PROD_DB_URI` sadece calisma ortaminda
tanimli olmali; `.env`, `config.json` ve uretilmis production ciktilari repoya
gonderilmemelidir.

## Beklenen dosyalar

- `company-profile.json`: company ve agent metadata'si
- `agents-and-routing.jsonl`: agent/intent/routing bilgisi
- `dynamic-agent-data.jsonl`: dynamic agent schema, form state, confirmation ve webhook durumlari
- `tool-catalog.json`: V1/V3 tool katalogu ve beklenen kullanim amaclari
- `eval/benchmark.jsonl`: insan tarafindan kontrol edilmesi gereken golden set
- `eval/adversarial.jsonl`: injection, kapsam disi ve escalation vakalari
- `eval/dynamic-agent-cases.jsonl`: dynamic agent schema/confirmation/webhook test sablonlari
- `eval/tool-cases.jsonl`: tool secimi icin sentetik test sablonlari
- `eval/hidden-test.jsonl`: RuneLab'a gonderilmeyecek holdout set
- `reports/export-summary.json`: sayimlar ve PII maskeleme ozeti
