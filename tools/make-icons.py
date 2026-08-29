"""Собирает комплект иконок приложения из одного описания знака.

Знак везде один и тот же и рисуется как рисовался: закрашенные дежурные
сутки и трое пустых — ОБВЕДЁННЫХ, а не залитых. Пустая клетка тем и пуста,
что внутри у неё ничего нет; залей её — и знак перестанет читаться
графиком, в котором занят один день из четырёх.

Меняется у него ровно один цвет. Обводка была тёплой серой краской
`#8a8578` и заметно отдавала в желтизну. Здесь она нейтральная и той же
светлоты: яркость по формуле сложения каналов у прежней краски выходила
133 из 255, у нынешней — ровно столько же. То есть знак не стал ни светлее,
ни темнее, из него ушёл только оттенок.

Оправа меняется от места к месту, и меняется не для красоты:

  ФАВИКОН (16—48 точек) и иконки Android — подложка со скруглением, как у
  вектора во вкладке.

  ПЛИТКА ДЛЯ ДОМАШНЕГО ЭКРАНА (apple-touch-icon, 180). Углы скругляет сама
  система, поэтому подложка идёт до самого края: своё скругление внутри
  системного дало бы двойную рамку.

  МАСКИРУЕМАЯ (Android, 512). Система вырезает из иконки круг, каплю или
  скруглённый квадрат — какой захочет производитель. Безопасная зона у
  такой иконки — центральные четыре пятых, и знак ужат до трёх пятых: всё,
  что снаружи, может быть срезано.

Геометрия задана в тех же двадцати четырёх единицах, что у вектора, и одна
на все размеры — иначе комплект разъедется при первой же правке.

Запуск: python3 tools/make-icons.py (из корня проекта)
"""

from PIL import Image, ImageDraw
import os

PLATE = "#1b1a18"  # подложка знака
SIGNAL = "#db0e17"  # дежурные сутки
IDLE = "#858585"  # пустые сутки: прежняя светлота, нейтральный тон

# Знак в двадцати четырёх единицах — ровно как в `src/app/icon.svg`.
UNITS = 24
FILLED = (3.0, 3.0, 8.5, 1.75)  # x, y, сторона, скругление
OUTLINED = ((13.4, 3.75), (3.75, 13.4), (13.4, 13.4))
OUTLINE_SIDE = 7.0
OUTLINE_RADIUS = 1.5
STROKE = 1.5
PLATE_RADIUS = 4.0

SS = 8  # во столько раз рисуем крупнее и потом уменьшаем — это и есть сглаживание


def draw(size, mark=1.0, rounded=True):
    """Знак на подложке. `mark` — во сколько раз он ужат к центру."""
    n = size * SS
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if rounded:
        d.rounded_rectangle([0, 0, n - 1, n - 1], radius=PLATE_RADIUS / UNITS * n, fill=PLATE)
    else:
        d.rectangle([0, 0, n - 1, n - 1], fill=PLATE)

    unit = n / UNITS
    centre = n / 2

    def at(v):
        """Единица знака в точках холста, с ужатием к центру."""
        return centre + (v * unit - centre) * mark

    x, y, side, radius = FILLED
    d.rounded_rectangle(
        [at(x), at(y), at(x + side), at(y + side)],
        radius=radius * unit * mark,
        fill=SIGNAL,
    )

    # Обводка у вектора идёт ПО ЛИНИИ, то есть половиной ложится наружу
    # рамки, а Pillow рисует её внутрь заданной коробки. Поэтому коробка
    # расширена на половину толщины: так закрашенные точки совпадают.
    half = STROKE * unit * mark / 2
    width = max(1, round(STROKE * unit * mark))
    for ox, oy in OUTLINED:
        d.rounded_rectangle(
            [
                at(ox) - half,
                at(oy) - half,
                at(ox + OUTLINE_SIDE) + half,
                at(oy + OUTLINE_SIDE) + half,
            ],
            radius=OUTLINE_RADIUS * unit * mark + half,
            outline=IDLE,
            width=width,
        )
    return img.resize((size, size), Image.LANCZOS)


def save(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    print(path, img.size)


# --- Вкладка браузера, вектором ---------------------------------------------
# Тот же знак и та же геометрия, только записанные разметкой.
def svg():
    x, y, side, radius = FILLED
    rects = [
        f'  <rect width="{UNITS}" height="{UNITS}" rx="{PLATE_RADIUS:g}" fill="{PLATE}"/>',
        f'  <rect x="{x:g}" y="{y:g}" width="{side:g}" height="{side:g}" '
        f'rx="{radius:g}" fill="{SIGNAL}"/>',
    ]
    for ox, oy in OUTLINED:
        rects.append(
            f'  <rect x="{ox:g}" y="{oy:g}" width="{OUTLINE_SIDE:g}" '
            f'height="{OUTLINE_SIDE:g}" rx="{OUTLINE_RADIUS:g}" '
            f'stroke="{IDLE}" stroke-width="{STROKE:g}"/>'
        )
    body = "\n".join(rects)
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'viewBox="0 0 {UNITS} {UNITS}" fill="none">\n{body}\n</svg>\n'
    )


with open("src/app/icon.svg", "w") as f:
    f.write(svg())
print("src/app/icon.svg")

# --- Вкладка, панель закладок, ярлык Windows --------------------------------
# Три размера в одном .ico.
draw(256).save("src/app/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
print("src/app/favicon.ico 16/32/48")

# --- Домашний экран айфона --------------------------------------------------
save(draw(180, rounded=False), "src/app/apple-icon.png")

# --- Android и установка как приложение -------------------------------------
save(draw(192), "public/icons/icon-192.png")
save(draw(512), "public/icons/icon-512.png")
save(draw(512, mark=0.75, rounded=False), "public/icons/icon-maskable-512.png")
