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
