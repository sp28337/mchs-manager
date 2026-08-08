# Развёртывание

Приложение — **статический сайт**. Сервера у него нет: расчёт и хранение
профиля живут в браузере, поэтому в проде исполняется только раздача
файлов. Это не деталь эксплуатации, а то же свойство приватности с другой
стороны: у сайта, который не исполняет код, нет и логов запросов к
персональным данным.

## Что нужно

* Node.js 24 — текущий Active LTS (нужен только для сборки; в проде Node
  не нужен вовсе). Next.js 16 требует минимум 20.9, но брать стоит LTS.
* pnpm 11: `corepack enable && corepack prepare pnpm@11 --activate`

Версии закреплены в `package.json` (`packageManager`, `engines`)
и в CI, чтобы сборка у вас и на сервере шла одним и тем же.

## Сборка

```bash
pnpm install --frozen-lockfile
NEXT_PUBLIC_SITE_URL=https://ваш-домен pnpm build
```

Результат — папка `out/`: `index.html` (лендинг),
`calculator.html`, `404.html`, `robots.txt`, `sitemap.xml`, `icon.svg` и
`_next/` со статикой.

### `NEXT_PUBLIC_SITE_URL` — обязательна

Адрес **вшивается в файлы на сборке**: он подставляется в `sitemap.xml`,
`robots.txt` и Open Graph. Забыть её — значит выложить в прод карту сайта,
указывающую на `http://localhost:3000`. Поисковик по такой карте не придёт,
а ссылка, отправленная в мессенджер, не раскроется.

Задавать без завершающего слэша: `https://example.ru`.

## Куда выкладывать

Подойдёт любой статический хостинг. Три рабочих варианта:

### Vercel

```bash
# Корень проекта — frontend/, переменная NEXT_PUBLIC_SITE_URL в настройках.
# Сборку и раздачу Vercel делает сам, `output: "export"` он уважает.
```

### Объектное хранилище (Yandex Object Storage, S3, Selectel)

Залить содержимое `out/` в бакет, включить раздачу как сайта, указать
`index.html` главной и `404.html` страницей ошибки. Перед бакетом — CDN с
HTTPS.

```bash
# Пример для s3-совместимого хранилища
aws s3 sync out/ s3://ваш-бакет/ --delete \
  --endpoint-url https://storage.yandexcloud.net
```

### Свой nginx

```nginx
server {
    listen 443 ssl http2;
    server_name example.ru;

    root /var/www/kalkulyator/out;
    index index.html;

    # Экспорт кладёт страницы как `calculator.html`. Без этой строки
    # адрес `/calculator` вернёт 404, хотя файл на месте.
    try_files $uri $uri.html $uri/index.html /404.html;

    # Файлы в `_next/` содержат хеш в имени и никогда не меняются под тем
    # же адресом — их можно кешировать навсегда.
    location /_next/static/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # HTML кешировать нельзя: иначе после выкладки человек неделю видит
    # прежний расчёт.
    location ~* \.html$ {
        add_header Cache-Control "no-cache";
    }

    gzip on;
    gzip_types text/css application/javascript image/svg+xml application/json;
}
```

## Заголовки безопасности

Приложение не делает ни одного сетевого запроса, поэтому политику можно
задать жёстко — и это стоит сделать: она превращает обещание «данные не
уходят» в проверяемое браузером правило.

```nginx
add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header X-Frame-Options "DENY" always;
```

`'unsafe-inline'` в `script-src` нужен Next.js для встроенного
загрузочного скрипта; `connect-src 'self'` — то самое правило, из-за
которого утечка данных наружу стала бы видна как ошибка в консоли.

Шрифты `next/font` собираются в `_next/static`, внешних запросов к Google
Fonts нет, поэтому `font-src 'self'` достаточно.

## Проверки перед выкладкой

```bash
pnpm typecheck   # типы
pnpm lint        # eslint
pnpm test        # 69 тестов: нормы приказов 307/308, график караула,
                 # раскладка смены по суткам, производственный календарь
pnpm build       # сборка
```

Всё это же гоняет CI на каждый pull request (`.github/workflows/ci.yml`).

## Автоматическая выкладка на VPS

`.github/workflows/cd.yml` срабатывает на push в `main`: вызывает CI,
забирает собранный им артефакт и раскладывает его по SSH. Пересборки при
выкладке нет — в прод уходит ровно то, что прошло проверки.

Что настроить в репозитории (Settings → Secrets and variables → Actions):

| | Имя | Значение |
|---|---|---|
| Variable | `SITE_URL` | `https://ваш-домен` — без слэша на конце |
| Variable | `DEPLOY_ROOT` | `/var/www/kalkulyator` |
| Variable | `SSH_PORT` | если не 22 |
| Secret | `SSH_HOST` | адрес сервера |
| Secret | `SSH_USER` | пользователь, владеющий `DEPLOY_ROOT` |
| Secret | `SSH_PRIVATE_KEY` | приватный ключ (ed25519), без пароля |
| Secret | `SSH_KNOWN_HOSTS` | вывод `ssh-keyscan -p ПОРТ хост` |

`SSH_KNOWN_HOSTS` снимается один раз руками и кладётся в секрет намеренно:
`ssh-keyscan` прямо в workflow доверял бы тому, кто ответил, и от подмены
сервера не защищал бы.

Подготовка сервера — один раз:

```bash
sudo mkdir -p /var/www/kalkulyator/releases
sudo chown -R deploy:deploy /var/www/kalkulyator
```

В nginx корнем указывается **симлинк** `current`, а не каталог выпуска:

```nginx
root /var/www/kalkulyator/current;
```

Каждая выкладка кладёт файлы в новый каталог `releases/ГГГГММДД-ЧЧММСС-хеш`
и переключает симлинк одной операцией `mv -Tf`. Поэтому человек никогда не
видит сайт, собранный наполовину из старого и наполовину из нового.
Хранятся пять последних выпусков, откат — переключение симлинка:

```bash
ln -sfn /var/www/kalkulyator/releases/НУЖНЫЙ /var/www/kalkulyator/current.new
mv -Tf /var/www/kalkulyator/current.new /var/www/kalkulyator/current
```

После выкладки CD сам проверяет, что по адресу отдаётся именно этот сайт:
на лендинге ищется заголовок, на `/calculator` — название, в `robots.txt`
— строка `Sitemap` с вашим доменом. Проверять код 200 бессмысленно: его
отдаёт и страница-заглушка хостера.

После выкладки проверить руками, потому что это ровно те вещи, которые
ломаются молча:

1. `https://ваш-домен/robots.txt` — в `Sitemap:` стоит ваш домен, не localhost.
2. `https://ваш-домен/sitemap.xml` — то же.
3. `/calculator` открывается по прямому адресу (проверка `try_files`).
4. Заполнить анкету, обновить страницу — профиль на месте.
5. **Отключить интернет и обновить страницу.** Расчёт продолжает работать
   — это и есть проверка обещания о приватности, вынесенного на лендинг.
6. В инструменте разработчика на вкладке «Сеть» после загрузки не должно
   быть ни одного запроса к чужим доменам.

## Обновление календаря на новый год

Единственное, что требует правки в коде раз в год. Постановление
Правительства о переносе выходных из закона не выводится, поэтому лежит
таблицей в `src/features/shift/domain/production-calendar.ts`:

```ts
const DECREE_TRANSFERS: Record<number, readonly IsoDate[]> = {
  2026: ["2026-01-09", "2026-12-31"],
};
```

Перечисляются **дни, ставшие нерабочими**. Года, которого в таблице нет,
приложение не выдумывает: оно показывает человеку, сколько выходных не
перенесено и на сколько часов из-за этого завышена норма, и предлагает
проставить их вручную в календаре года. Так что забытое обновление не даст
неверного ответа молча — но лучше не забывать.

## Чего в проде нет и не должно появиться

* базы данных — персональные данные не покидают браузер;
* серверного кода — бэкенд удалён целиком;
* аналитики и счётчиков — сторонний скрипт на странице калькулятора
  получил бы доступ к сведениям о здоровье в `localStorage`. Если статистика
  посещений нужна, ставьте её **только на лендинг** (`/`) и только
  такую, что не читает хранилище.
