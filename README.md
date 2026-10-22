# Семейный бюджет: установка

## 1. База данных (Supabase)
1. supabase.com -> ваш проект -> **SQL Editor** -> New query.
2. Вставьте весь файл `schema.sql` -> **Run**. Должно быть "Success".
3. **Authentication -> Providers -> Email**: выключите **Confirm email** (так вы с женой регистрируетесь без писем).
4. **Project Settings -> API**: скопируйте **anon public** key (длинная строка, начинается с `eyJ`). Секретный `service_role` НЕ копируйте.
5. Откройте `config.js` и замените `ВСТАВЬТЕ_СЮДА_ANON_KEY` на ваш ключ.

## 2. Публикация сайта (GitHub Pages)
1. github.com -> New repository (например `budget`), Public.
2. Add file -> Upload files -> перетащите ВСЕ файлы из этой папки -> Commit.
3. Settings -> Pages -> Source: Deploy from a branch -> Branch: main, папка / (root) -> Save.
4. Через минуту сайт будет по адресу `https://ВАШ_ЛОГИН.github.io/budget/`.

## 3. Первый запуск
1. Откройте сайт, нажмите "Зарегистрироваться", введите почту и пароль.
2. Введите имя и нажмите "Создать семью".
3. Вкладка "Бюджет" -> скопируйте код приглашения и отправьте жене.
4. Жена регистрируется, вводит имя и код, нажимает "Присоединиться".
5. Установите на телефон: iPhone - Safari -> Поделиться -> "На экран Домой". Android - Chrome -> меню -> "Установить приложение".

Чтобы закрыть регистрацию для посторонних: Authentication -> Sign In / Providers -> выключите "Allow new users to sign up".
