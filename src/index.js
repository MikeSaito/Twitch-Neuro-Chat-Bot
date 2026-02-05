import { config } from './config.js';
import readline from 'readline';
import { VirtualBrowser } from './modules/browser.js';
import { ImageAnalyzer } from './modules/imageAnalyzer.js';
import { SpeechRecognizer } from './modules/speechRecognizer.js';
import { MessageGenerator } from './modules/messageGenerator.js';
import { LocalVoiceIdentifier } from './modules/localVoiceIdentifier.js';
import { Coordinator } from './modules/coordinator.js';
import { TwitchClient } from './twitchClient.js';
import { DataCollector } from './modules/dataCollector.js';
import { BrainCoordinator } from './modules/brainCoordinator.js';
import { BrainAssistant } from './modules/brainAssistant.js';
import { ChatReader } from './modules/chatReader.js';
import { RightHand } from './modules/rightHand.js';
import { BrainTrainer } from './modules/brainTrainer.js';

class TwitchNeuroBot {
  constructor() {
    this.modules = {
      browser: null,
      imageAnalyzer: null,
      speechRecognizer: null,
      messageGenerator: null,
      messageGenerator2: null, // Второй экземпляр для параллельной работы
      voiceIdentifier: null,
      dataCollector: null,
      brainCoordinator: null, // Мозг - личность, управляет органами
      brainAssistant: null, // Помощник для сложных задач
      chatReader: null, // Нейронка для чтения чата
      rightHand: null, // Правая рука мозга для сложных задач
      brainTrainer: null, // Модуль обучения мозга
    };
    this.coordinator = null;
    this.twitchClient = null;
    this.isRunning = false;
    this.messageGenerationInterval = null; // Интервал генерации сообщений
    this.audioCaptureInterval = null; // Интервал захвата аудио
    this.chatReadingInterval = null; // Интервал чтения чата
  }

  async init() {
    console.log('🚀 Инициализация Twitch Neuro Chat Bot...\n');

    // Проверка конфигурации
    if (!config.twitch.username || !config.twitch.oauthToken) {
      throw new Error('Не указаны Twitch credentials в .env файле');
    }

    if (!config.openai.apiKey) {
      throw new Error('Не указан OpenAI API ключ в .env файле');
    }

    // Инициализация модулей
    console.log('📦 Инициализация модулей...');
    
    // Настройка использования локальных моделей и ProxyAPI
    const useLocalWhisper = config.local.useLocalWhisper;
    const useLocalLLM = config.local.useLocalLLM;
    const useLocalVision = config.local.useLocalVision;
    const useProxyAPI = config.proxyapi.enabled;
    
    console.log(`\n💡 Режим работы:`);
    const whisperMode = useLocalWhisper ? '🖥️  ЛОКАЛЬНЫЙ' : (useProxyAPI ? '🇷🇺 ProxyAPI' : '☁️  OpenAI API');
    const llmMode = useLocalLLM ? '🖥️  ЛОКАЛЬНЫЙ' : (useProxyAPI ? '🇷🇺 ProxyAPI' : '☁️  OpenAI API');
    const visionMode = useLocalVision ? '🖥️  ЛОКАЛЬНЫЙ' : (useProxyAPI ? '🇷🇺 ProxyAPI' : '☁️  OpenAI API');
    console.log(`   Whisper: ${whisperMode}`);
    console.log(`   LLM: ${llmMode}`);
    console.log(`   Vision: ${visionMode}\n`);
    
    this.modules.imageAnalyzer = new ImageAnalyzer({
      ...config.openai,
      useLocal: useLocalVision,
      useProxyAPI: useProxyAPI,
      proxyAPIKey: config.proxyapi.apiKey,
      proxyAPIBaseUrl: config.proxyapi.baseUrl,
      proxyAPIProvider: config.proxyapi.provider,
      proxyAPIVisionModel: config.proxyapi.visionModel,
      localOllamaUrl: config.local.ollamaUrl,
      localOllamaVisionModel: config.local.ollamaVisionModel,
      localLLMProvider: config.local.llmProvider,
    });
    
    this.modules.speechRecognizer = new SpeechRecognizer({
      ...config.openai,
      useLocal: useLocalWhisper,
      useProxyAPI: useProxyAPI,
      proxyAPIKey: config.proxyapi.apiKey,
      proxyAPIBaseUrl: config.proxyapi.baseUrl,
      proxyAPIProvider: config.proxyapi.provider,
      proxyAPIWhisperModel: config.proxyapi.whisperModel,
      localWhisperModel: config.local.whisperModel,
      localWhisperDevice: config.local.whisperDevice,
    });
    
    // Создаем несколько экземпляров генератора для параллельной работы
    const messageGenConfig = {
      ...config.openai,
      useLocal: useLocalLLM,
      useProxyAPI: useProxyAPI,
      proxyAPIKey: config.proxyapi.apiKey,
      proxyAPIBaseUrl: config.proxyapi.baseUrl,
      proxyAPIProvider: config.proxyapi.provider,
      proxyAPIChatModel: config.proxyapi.chatModel,
      localOllamaUrl: config.local.ollamaUrl,
      localOllamaModel: config.local.ollamaModel,
      localLLMProvider: config.local.llmProvider,
    };
    
    this.modules.messageGenerator = new MessageGenerator(messageGenConfig);
    this.modules.messageGenerator2 = new MessageGenerator(messageGenConfig); // Второй экземпляр
    
    // Инициализация модулей мозга
    const brainMode = config.coordinator.brainMode || 'normal';
    this.modules.brainCoordinator = new BrainCoordinator({
      useLocal: useLocalLLM,
      localOllamaUrl: config.local.ollamaUrl,
      localOllamaModel: config.local.ollamaModel,
      mode: brainMode, // Режим работы: 'normal' или 'training'
    });
    
    this.modules.brainAssistant = new BrainAssistant({
      useLocal: useLocalLLM,
      localOllamaUrl: config.local.ollamaUrl,
      localOllamaModel: config.local.ollamaModel,
    });
    
    // Инициализация правой руки
    this.modules.rightHand = new RightHand({
      useLocal: useLocalLLM,
      localOllamaUrl: config.local.ollamaUrl,
      localOllamaModel: config.local.ollamaModel,
    });
    
    // Инициализация нейронки для чтения чата
    this.modules.chatReader = new ChatReader({
      useLocal: useLocalLLM,
      localOllamaUrl: config.local.ollamaUrl,
      localOllamaModel: config.local.ollamaModel,
    });
    
    // Инициализация модуля обучения (только в режиме обучения)
    if (brainMode === 'training') {
      this.modules.brainTrainer = new BrainTrainer({
        useLocal: useLocalLLM,
        localOllamaUrl: config.local.ollamaUrl,
        localOllamaModel: config.local.ollamaModel,
      });
      await this.modules.brainTrainer.init();
    }
    
    // Инициализация локальных моделей
    await this.modules.imageAnalyzer.init();
    await this.modules.speechRecognizer.init();
    await this.modules.messageGenerator.init();
    await this.modules.messageGenerator2.init();
    await this.modules.brainCoordinator.init();
    await this.modules.brainAssistant.init();
    await this.modules.rightHand.init();
    await this.modules.chatReader.init();
    
    // Связываем правую руку с мозгом
    this.modules.brainCoordinator.setRightHand(this.modules.rightHand);
    
    // Связываем brainCoordinator с модулями для оптимизации промптов
    this.modules.imageAnalyzer.brainCoordinator = this.modules.brainCoordinator;
    this.modules.chatReader.brainCoordinator = this.modules.brainCoordinator;
    
    // Связываем brainCoordinator с модулями для запроса скриншотов
    this.modules.brainCoordinator.setBrowser(this.modules.browser);
    this.modules.brainCoordinator.setImageAnalyzer(this.modules.imageAnalyzer);
    this.modules.brainCoordinator.setCoordinator(this.coordinator);
    
    // Инициализация идентификатора голосов (мозг для распознавания голосов)
    this.modules.voiceIdentifier = new LocalVoiceIdentifier({
      streamerName: config.twitch.streamerName,
    });
    await this.modules.voiceIdentifier.init();
    
    this.modules.browser = new VirtualBrowser({
      headless: config.browser.headless,
      channel: config.twitch.channel,
      screenshotInterval: config.browser.screenshotInterval,
    });

    // Инициализация сборщика данных для обучения
    this.modules.dataCollector = new DataCollector({
      enabled: process.env.ENABLE_DATA_COLLECTION !== 'false', // По умолчанию включен
    });
    await this.modules.dataCollector.init();

    // Инициализация координатора
    this.coordinator = new Coordinator({
      ...config.coordinator,
      twitch: config.twitch, // Передаем конфигурацию Twitch для доступа к имени бота
    }, this.modules);

    // Инициализация Twitch клиента (передаем dataCollector и brainTrainer для режима обучения)
    this.twitchClient = new TwitchClient(
      this.coordinator, 
      this.modules.dataCollector,
      this.modules.brainTrainer // Передаем модуль обучения
    );

    console.log('✅ Все модули инициализированы\n');
  }

  async start() {
    if (this.isRunning) {
      console.log('⚠️  Бот уже запущен');
      return;
    }

    try {
      await this.init();

      // Подключаемся к Twitch чату
      console.log('🔌 Подключение к Twitch чату...');
      await this.twitchClient.connect();

      // Инициализируем браузер
      console.log('🌐 Запуск виртуального браузера...');
      await this.modules.browser.init();

      // Запускаем цикл скриншотов
      console.log('📸 Запуск цикла анализа стрима...\n');
      this.isRunning = true;

      // Запускаем два независимых цикла:
      // 1. Цикл обработки изображений (каждые 5 секунд)
      // 2. Цикл генерации сообщений (использует уже обработанные данные)

      // ЦИКЛ 1: Обработка скриншотов (каждые 5 секунд)
      console.log('📸 Запуск цикла обработки скриншотов (каждые 5 секунд)...');
      await this.modules.browser.startScreenshotLoop(async (screenshot) => {
        if (!this.isRunning) return;

        // Обрабатываем только изображение (параллельно, не блокируя)
        this.coordinator.processImageOnly(screenshot).catch(error => {
          console.error('[Main] Ошибка обработки изображения:', error);
        });

        // Сбор данных для обучения (асинхронно)
        this.collectDataForTraining(screenshot).catch(error => {
          console.error('[Main] Ошибка сбора данных:', error);
        });
      });

      // ЦИКЛ 2: Обработка голоса/аудио (каждые 5 секунд)
      console.log('🎤 Запуск цикла обработки голоса (каждые 5 секунд)...');
      this.audioCaptureInterval = await this.modules.browser.startAudioCaptureLoop(async (audioBuffer) => {
        if (!this.isRunning) return;

        // Обрабатываем голос (параллельно, не блокируя)
        this.coordinator.processAudioOnly(audioBuffer).catch(error => {
          console.error('[Main] Ошибка обработки голоса:', error);
        });
      }, 5000);

      // ЦИКЛ 3: Чтение чата через ChatReader (не нагружает мозг)
      console.log('💬 Запуск цикла чтения чата (каждые 15 секунд)...');
      this.chatReadingInterval = setInterval(async () => {
        if (!this.isRunning) {
          clearInterval(this.chatReadingInterval);
          return;
        }

        try {
          // Читаем чат через ChatReader
          if (this.modules.chatReader && this.coordinator) {
            const chatHistory = this.coordinator.contextBuffer.chatHistory || [];
            const context = {
              imageAnalysis: this.coordinator.contextBuffer.recentImageAnalysis[this.coordinator.contextBuffer.recentImageAnalysis.length - 1],
              speechText: this.coordinator.contextBuffer.recentSpeechText[this.coordinator.contextBuffer.recentSpeechText.length - 1],
              chatHistory: chatHistory,
              time: Date.now(),
            };
            
            const interestingMessages = await this.modules.chatReader.findInterestingMessages(chatHistory, context);
            
            if (interestingMessages.length > 0) {
              console.log(`[ChatReader] 🎯 Найдено интересных сообщений: ${interestingMessages.length}`);
            }
          }
        } catch (error) {
          console.error('[Main] Ошибка чтения чата:', error);
        }
      }, 15000); // Читаем чат каждые 15 секунд

      // ЦИКЛ 4: Генерация сообщений (использует уже обработанные данные)
      console.log('💬 Запуск цикла генерации сообщений (каждые 10 секунд)...');
      this.messageGenerationInterval = setInterval(async () => {
        if (!this.isRunning) {
          clearInterval(this.messageGenerationInterval);
          return;
        }

        try {
          const message = await this.coordinator.generateMessageFromContext();
          if (message) {
            await this.twitchClient.sendMessage(message);
            // Обновляем время последнего сообщения в мозге
            if (this.modules.brainCoordinator) {
              this.modules.brainCoordinator.setLastMessageTime(Date.now());
            }
          }
        } catch (error) {
          console.error('[Main] Ошибка генерации сообщения:', error);
        }
      }, 10000); // Проверяем каждые 10 секунд, можно ли сгенерировать сообщение

      const currentMode = this.modules.brainCoordinator?.mode || 'normal';
      console.log('✅ Бот запущен и работает!\n');
      console.log(`🧠 Режим работы мозга: ${currentMode === 'training' ? 'ОБУЧЕНИЕ' : 'ОСНОВНОЙ'}\n`);
      console.log('Команды для управления (в Twitch чате или в терминале):');
      console.log('  !bot silence - включить режим молчания');
      console.log('  !bot unsilence - выключить режим молчания');
      console.log('  !bot stats - показать статистику');
      console.log('  !bot mode - переключить режим работы мозга');
      console.log('  !bot training - включить режим обучения');
      console.log('  !bot normal - включить основной режим');
      console.log('  !bot memory - показать статистику памяти');
      console.log('  !bot forget - очистить память');
      console.log('  !bot screenshot - запросить скриншот от мозга\n');
      
      // Запускаем обработчик команд из терминала
      this.setupTerminalCommands();

    } catch (error) {
      console.error('❌ Ошибка запуска:', error);
      await this.stop();
      process.exit(1);
    }
  }

  /**
   * Настройка обработки команд из терминала
   */
  setupTerminalCommands() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> ',
    });

    rl.on('line', async (input) => {
      const command = input.trim();
      
      if (!command) {
        rl.prompt();
        return;
      }

      // Обрабатываем команды как будто они пришли из чата
      if (command.startsWith('!bot')) {
        await this.handleTerminalCommand(command);
      } else {
        console.log('💡 Введите команду, начинающуюся с !bot (например: !bot stats)');
      }
      
      rl.prompt();
    });

    rl.on('close', () => {
      console.log('\n👋 Завершение работы...');
      this.stop().then(() => process.exit(0));
    });

    // Показываем приглашение
    rl.prompt();
    
    this.terminalReadline = rl;
  }

  /**
   * Обработка команды из терминала
   */
  async handleTerminalCommand(command) {
    const parts = command.split(' ');
    const cmd = parts[1];

    try {
      switch (cmd) {
        case 'silence':
          this.coordinator.setSilenceMode(true);
          console.log('✅ Режим молчания включен');
          break;
        case 'unsilence':
          this.coordinator.setSilenceMode(false);
          console.log('✅ Режим молчания выключен');
          break;
        case 'stats':
          const stats = this.coordinator.getStats();
          console.log('\n📊 СТАТИСТИКА БОТА:');
          console.log(`  Всего сообщений: ${stats.totalMessages}`);
          console.log(`  Пропущено: ${stats.skippedMessages}`);
          console.log(`  Режим молчания: ${stats.silenceMode ? 'ВКЛ' : 'ВЫКЛ'}`);
          console.log(`  Размер контекста:`);
          console.log(`    - Анализы изображений: ${stats.contextBufferSize?.imageAnalysis || 0}`);
          console.log(`    - Распознанная речь: ${stats.contextBufferSize?.speechText || 0}`);
          console.log(`    - История чата: ${stats.contextBufferSize?.chatHistory || 0}`);
          break;
        case 'mode':
          const currentMode = this.modules.brainCoordinator?.mode || 'normal';
          console.log(`🧠 Текущий режим: ${currentMode === 'training' ? 'ОБУЧЕНИЕ' : 'ОСНОВНОЙ'}`);
          break;
        case 'training':
          if (this.modules.brainCoordinator) {
            this.modules.brainCoordinator.setMode('training');
            console.log('✅ Режим обучения включен');
          }
          break;
        case 'normal':
          if (this.modules.brainCoordinator) {
            this.modules.brainCoordinator.setMode('normal');
            console.log('✅ Основной режим включен');
          }
          break;
        case 'memory':
          if (this.modules.brainMemory) {
            const memoryStats = this.modules.brainMemory.getStats();
            console.log('\n💾 СТАТИСТИКА ПАМЯТИ:');
            console.log(`  Всего записей: ${memoryStats.totalEntries}`);
            console.log(`  Важных записей: ${memoryStats.importantEntries}`);
            console.log(`  Категорий: ${memoryStats.categories.length}`);
            if (memoryStats.categories.length > 0) {
              console.log(`  Категории: ${memoryStats.categories.join(', ')}`);
            }
          }
          break;
        case 'forget':
          if (this.modules.brainMemory) {
            this.modules.brainMemory.clear();
            console.log('✅ Память очищена');
          }
          break;
        case 'screenshot':
          if (this.modules.brainCoordinator) {
            const context = {
              recentImageAnalysis: this.coordinator.contextBuffer.recentImageAnalysis,
              speechText: this.coordinator.contextBuffer.recentSpeechText[this.coordinator.contextBuffer.recentSpeechText.length - 1],
              chatHistory: this.coordinator.contextBuffer.chatHistory,
              time: Date.now(),
            };
            const result = await this.modules.brainCoordinator.requestScreenshot(context);
            if (result) {
              console.log(`✅ Скриншот получен и проанализирован: ${result.description?.substring(0, 100)}...`);
            } else {
              console.log('⏳ Запрос скриншота отклонен (слишком частый или не нужен)');
            }
          }
          break;
        default:
          console.log(`❓ Неизвестная команда: ${cmd}`);
          console.log('Доступные команды: silence, unsilence, stats, mode, training, normal, memory, forget, screenshot');
      }
    } catch (error) {
      console.error('❌ Ошибка выполнения команды:', error.message);
    }
  }

  /**
   * Сбор данных для обучения (параллельно с обработкой, не блокируя)
   */
  async collectDataForTraining(screenshot) {
    if (!this.modules.dataCollector || !this.modules.dataCollector.enabled) {
      return;
    }

    // Запускаем сбор данных асинхронно, не блокируя основной цикл
    // Используем setTimeout для полной асинхронности
    setImmediate(async () => {
      try {
        // Ждем немного, чтобы анализ изображения успел завершиться
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Получаем текущий контекст
        const imageAnalysis = this.coordinator.contextBuffer.recentImageAnalysis[
          this.coordinator.contextBuffer.recentImageAnalysis.length - 1
        ] || null;

        const speechText = this.coordinator.contextBuffer.recentSpeechText[
          this.coordinator.contextBuffer.recentSpeechText.length - 1
        ] || null;

        const chatMessages = this.coordinator.contextBuffer.chatHistory.slice(-10) || [];

        // Сохраняем данные (не блокируя основной цикл)
        await this.modules.dataCollector.saveScreenshot(
          screenshot,
          imageAnalysis,
          speechText,
          chatMessages
        );

        // Сохраняем речь если есть
        if (speechText) {
          await this.modules.dataCollector.saveSpeech(speechText);
        }
      } catch (error) {
        console.error('[Main] Ошибка сбора данных:', error);
      }
    });
  }

  async stop() {
    // Закрываем readline если был создан
    if (this.terminalReadline) {
      this.terminalReadline.close();
      this.terminalReadline = null;
    }
    console.log('\n🛑 Остановка бота...');
    this.isRunning = false;
    
    // Останавливаем цикл генерации сообщений
    if (this.messageGenerationInterval) {
      clearInterval(this.messageGenerationInterval);
      this.messageGenerationInterval = null;
    }
    
    // Сохраняем данные перед остановкой
    if (this.modules.dataCollector && this.modules.dataCollector.enabled) {
      console.log('[DataCollector] Сохранение сессии...');
      await this.modules.dataCollector.endSession();
    }

    if (this.modules.browser) {
      await this.modules.browser.stop();
    }

    if (this.twitchClient) {
      await this.twitchClient.disconnect();
    }

    console.log('✅ Бот остановлен');
  }
}

// Обработка завершения процесса
process.on('SIGINT', async () => {
  if (bot) {
    await bot.stop();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (bot) {
    await bot.stop();
  }
  process.exit(0);
});

// Запуск бота
const bot = new TwitchNeuroBot();
bot.start().catch((error) => {
  console.error('Критическая ошибка:', error);
  process.exit(1);
});
