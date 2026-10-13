# Budget – webbapp för iPhone

Personlig budgetapp: månadsbudget per kategori, daglig balans, sparmål, CSV-import från banken och manuell inmatning. All data sparas lokalt på telefonen – inget skickas någonstans.

## Lägg upp appen (GitHub Pages, gratis)

1. Skapa ett konto på github.com om du inte har ett.
2. Klicka **New repository**, döp det till t.ex. `budget`, välj **Public** och skapa det.
3. Klicka **uploading an existing file** och dra in *alla filer och mappar* i den här mappen (index.html, app.js, styles.css, sw.js, manifest.webmanifest, mapparna `fonts` och `icons`). Klicka **Commit changes**.
4. Gå till **Settings › Pages**. Under *Branch* välj `main` och `/ (root)`, klicka **Save**.
5. Efter någon minut finns appen på `https://<ditt-användarnamn>.github.io/budget/`.

## Installera på iPhone

1. Öppna adressen i **Safari**.
2. Tryck på **Dela** › **Lägg till på hemskärmen** (se till att *Öppna som webbapp* är på) › **Lägg till**.
3. Starta appen från hemskärmen – den öppnas i helskärm och fungerar utan internet.

## Uppdatera appen

Ladda upp de ändrade filerna till samma repo. Öka sedan `VERSION` i `sw.js` (t.ex. `budget-v1.0.1`) så hämtar telefonen den nya versionen nästa gång appen öppnas med internet. Din data påverkas inte.

## Planera månaden (v1.2)

Under **Budget › Plan** fyller du i inkomst och lönedag, fasta utgifter (förslag är ifyllda – ta bort med ×), sparande per sparmål och rörliga utgifter. Appen visar vad som blir **ofördelat** och låter dig fördela resten med ett tryck. **Utfall** visar hur det faktiskt går, inklusive vilka räkningar som dragits.

## Månatlig påminnelse

Under **Inställningar › Månatlig påminnelse** väljer du dag och trycker **Lägg till i kalendern**. Då öppnas en kalenderfil (`paminnelse-XX.ics`) och iPhone frågar om du vill lägga till händelsen – välj *Lägg till alla*. Påminnelsen upprepas varje månad kl. 18.00 och ändras eller tas bort i Kalender-appen. Kalenderfilerna ska ligga i samma mapp som `index.html`.

## Synk mellan mobil och dator (v1.4)

1. Skapa en nyckel på GitHub: **Settings › Developer settings › Personal access tokens › Fine-grained tokens › Generate new token**. Under *Account permissions* väljer du **Gists: Read and write**. Välj en lång giltighetstid.
2. I appen: **Inställningar › Synk mellan enheter**. Klistra in nyckeln och välj ett lösenord för krypteringen.
3. Gör samma sak på den andra enheten med **samma nyckel och samma lösenord**.

Budgeten sparas krypterad (AES-256) i en privat Gist som heter `budget-sync.json`. Utan ditt lösenord går den inte att läsa – och lösenordet kan inte återställas. Appen hämtar ändringar när den öppnas och skickar upp ändringar automatiskt. Om båda enheterna ändrats samtidigt behålls den senaste versionen.

## Backup

Datan finns bara på telefonen. Använd **Inställningar › Säkerhetskopiera** då och då och spara filen i iCloud Drive. Återställ med **Återställ säkerhetskopia**.

## CSV-import

Exportera kontohändelser från internetbanken som CSV och välj filen under **Import**. Appen hittar kolumner för datum, text och belopp själv (testat med format liknande Swedbank, Nordea, SEB och Handelsbanken) – fel kolumn kan ändras i förhandsvisningen. Kategorier föreslås automatiskt och appen lär sig av dina val. Rader som redan importerats hoppas över.

Typsnitt: Geist och Geist Mono (SIL Open Font License, se `fonts/OFL-Geist.txt`).
