import { VirtualBrowser } from './src/modules/browser.js';
import { SpeechRecognizer } from './src/modules/speechRecognizer.js';
import { config } from './src/config.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Загружаем переменные окружения
dotenv.config({ path: join(__dirname, '.env') });

const channel = process.env.TWITCH_CHANNEL || 'k1im';

console.log('🎤 Тест извлечения текста из аудио Twitch стрима');
console.log(`📺 Канал: ${channel}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Определяем, какой метод распознавания используется
const useLocalWhisper = config.local.useLocalWhisper;
const useProxyAPI = config.proxyapi.enabled;

console.log('📋 Конфигурация распознавания речи:');
if (useLocalWhisper) {
  console.log(`   ✅ Локальный Whisper (модель: ${config.local.whisperModel})`);
} else if (useProxyAPI) {
  console.log(`   ✅ ProxyAPI (модель: ${config.proxyapi.whisperModel})`);
} else {
  console.log(`   ✅ OpenAI Whisper (модель: whisper-1)`);
}
console.log('');

const browser = new VirtualBrowser({
  channel: channel,
  screenshotInterval: 5000,
  headless: true,
});

// Создаем SpeechRecognizer с правильной конфигурацией
const speechRecognizer = new SpeechRecognizer({
  useLocal: useLocalWhisper,
  useProxyAPI: useProxyAPI,
  apiKey: config.openai.apiKey,
  proxyAPIKey: config.proxyapi.apiKey,
  proxyAPIBaseUrl: config.proxyapi.baseUrl,
  proxyAPIProvider: config.proxyapi.provider,
  proxyAPIWhisperModel: config.proxyapi.whisperModel,
  localWhisperModel: config.local.whisperModel,
  localWhisperDevice: config.local.whisperDevice,
});

async function testSpeechRecognition() {
  try {
    console.log('1️⃣ Инициализация модулей...');
    await browser.init();
    await speechRecognizer.init();
    console.log('✅ Модули инициализированы\n');

    // Ожидание убрано - начинаем сразу
    console.log('2️⃣ Начинаем тестирование сразу...\n');

    // Тестируем захват и распознавание аудио несколько раз
    for (let i = 1; i <= 3; i++) {
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log(`🎤 ТЕСТ #${i} - Захват и распознавание аудио (5 секунд)`);
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
      
      const startTime = Date.now();
      
      // Шаг 1: Захват аудио
      console.log('📥 Шаг 1: Захват аудио...');
      const audioBuffer = await browser.captureAudio(5);
      const captureDuration = Date.now() - startTime;
      
      if (!audioBuffer || audioBuffer.length === 0) {
        console.log(`\n❌ НЕУДАЧА: Аудио не захвачено`);
        console.log(`   ⏱️  Время попытки: ${captureDuration}ms\n`);
        
        if (i < 3) {
          console.log('⏳ Пауза 3 секунды перед следующим тестом...\n');
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
        continue;
      }
      
      console.log(`✅ Аудио захвачено: ${audioBuffer.length} байт (${(audioBuffer.length / 1024).toFixed(2)} KB)`);
      console.log(`   ⏱️  Время захвата: ${captureDuration}ms`);
      console.log(`   💾 MP3 файл сохранен в папке: C:\\Users\\Mike\\AppData\\Local\\Temp\\twitch_bot_audio\\`);
      console.log(`   📁 Проверьте файлы audio_*.mp3 в этой папке для прослушивания\n`);
      
      // Шаг 2: Распознавание речи
      console.log('🎤 Шаг 2: Распознавание речи...');
      const recognitionStartTime = Date.now();
      const recognitionResult = await speechRecognizer.recognizeFromStream(audioBuffer);
      const recognitionDuration = Date.now() - recognitionStartTime;
      
      console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      console.log('📊 РЕЗУЛЬТАТ РАСПОЗНАВАНИЯ:');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      if (recognitionResult && recognitionResult.text) {
        console.log(`✅ ТЕКСТ: "${recognitionResult.text}"`);
        console.log(`📊 Уверенность: ${(recognitionResult.confidence * 100).toFixed(1)}%`);
        if (recognitionResult.language) {
          console.log(`🌐 Язык: ${recognitionResult.language}`);
        }
        console.log(`⏱️  Время распознавания: ${recognitionDuration}ms`);
        console.log(`📏 Длина текста: ${recognitionResult.text.length} символов`);
      } else {
        console.log(`❌ Текст не распознан`);
        if (recognitionResult && recognitionResult.error) {
          console.log(`⚠️  Ошибка: ${recognitionResult.error}`);
        } else {
          console.log(`⚠️  Возможные причины:`);
          console.log(`   - В аудио нет речи (тишина)`);
          console.log(`   - Речь слишком тихая или неразборчивая`);
          console.log(`   - Проблема с моделью распознавания`);
        }
        console.log(`⏱️  Время распознавания: ${recognitionDuration}ms`);
      }
      
      console.log(`\n⏱️  Общее время (захват + распознавание): ${Date.now() - startTime}ms`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
      
      // Пауза между тестами
      if (i < 3) {
        console.log('⏳ Пауза 5 секунд перед следующим тестом...\n');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Тестирование завершено');
    
  } catch (error) {
    console.error('\n❌ ОШИБКА:', error);
    console.error(error.stack);
  } finally {
    console.log('\n🛑 Закрытие модулей...');
    await browser.stop();
    console.log('✅ Модули закрыты');
    process.exit(0);
  }
}

// Обработка сигналов для корректного завершения
process.on('SIGINT', async () => {
  console.log('\n\n⚠️  Получен сигнал прерывания, закрываю модули...');
  await browser.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n\n⚠️  Получен сигнал завершения, закрываю модули...');
  await browser.stop();
  process.exit(0);
});

// Запускаем тест
testSpeechRecognition();
