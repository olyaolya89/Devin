# LumenCut v1

Локальный генератор коротких видео из дословного сценария: Edge TTS, открытые медиа и ffmpeg.

## Запуск

```bash
cd lumencut
cp .env.example .env
npm install
npm run dev
```

Express работает на `8787`, Vite — на `5173`. Откройте http://localhost:5173.

### Переменные

`LLM_PROVIDER=none` работает без ключа и строит запросы эвристикой. Для Gemini или Ollama задайте соответствующие параметры. Ключи Pexels/Pixabay необязательны. Нужен `ffmpeg` и `ffprobe` в PATH (можно задать `FFMPEG_PATH`).

Все источники — Wikimedia Commons и Openverse без ключа, либо бесплатные Pexels/Pixabay при наличии ключей. Скрипт сохраняется дословно: перевод и переписывание не выполняются.
