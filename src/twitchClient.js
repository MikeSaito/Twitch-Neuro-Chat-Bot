import tmi from 'tmi.js';
import { config } from './config.js';

export class TwitchClient {
  constructor(coordinator, dataCollector = null, brainTrainer = null) {
    this.coordinator = coordinator;
    this.dataCollector = dataCollector;
    this.brainTrainer = brainTrainer; // Модуль обучения для режима обучения
    this.client = null;
  }

  async connect() {
    this.client = new tmi.Client({
      options: { debug: false },
      connection: {
        reconnect: true,
        secure: true,
      },
      identity: {
        username: config.twitch.username,
        password: config.twitch.oauthToken,
      },
      channels: [config.twitch.channel],
    });

    // Обработчики событий
    this.client.on('connected', (addr, port) => {
      console.log(`[Twitch] Подключен к ${addr}:${port}`);
    });

    this.client.on('join', (channel, username, self) => {
      if (self) {
        console.log(`[Twitch] Присоединился к каналу: ${channel}`);
      }
    });

    this.client.on('message', async (channel, tags, message, self) => {
      if (self) return; // Игнорируем свои сообщения

      const chatMessage = {
        username: tags.username,
        message: message,
        timestamp: Date.now(),
      };

      // Обновляем историю чата в координаторе
      this.coordinator.updateChatHistory(chatMessage);

      // В режиме обучения передаем сообщения напрямую в brainTrainer
      if (this.brainTrainer) {
        const context = {
          imageAnalysis: this.coordinator.contextBuffer.recentImageAnalysis[this.coordinator.contextBuffer.recentImageAnalysis.length - 1],
          speechText: this.coordinator.contextBuffer.recentSpeechText[this.coordinator.contextBuffer.recentSpeechText.length - 1],
          chatHistory: this.coordinator.contextBuffer.chatHistory,
          time: Date.now(),
        };
        
        this.brainTrainer.processChatMessage(chatMessage, context).catch(error => {
          console.error('[TwitchClient] Ошибка обработки сообщения в режиме обучения:', error);
        });
      }

      // Сохраняем сообщение для обучения (асинхронно, не блокируя)
      if (this.dataCollector && this.dataCollector.enabled) {
        this.dataCollector.saveChatMessage(
          chatMessage.username,
          chatMessage.message,
          chatMessage.timestamp
        ).catch(error => {
          console.error('[TwitchClient] Ошибка сохранения сообщения:', error);
        });
      }

      // Команды управления ботом отключены в чате - используйте терминал
    });

    this.client.on('disconnected', (reason) => {
      console.log(`[Twitch] Отключен: ${reason}`);
    });

    await this.client.connect();
  }

  async sendMessage(message) {
    // Валидация сообщения
    if (!message || typeof message !== 'string') {
      console.warn('[Twitch] ⚠️ Попытка отправить пустое или невалидное сообщение');
      return false;
    }

    // Очистка сообщения от лишних пробелов и переносов строк
    const cleanedMessage = message.trim().replace(/\n+/g, ' ').substring(0, 500);
    
    if (cleanedMessage.length < 1) {
      console.warn('[Twitch] ⚠️ Сообщение слишком короткое после очистки');
      return false;
    }

    // Режим только консоли - выводим в консоль вместо отправки в чат
    if (config.debug.consoleOnly) {
      console.log(`\n💬 [БОТ ХОЧЕТ ОТПРАВИТЬ]: ${cleanedMessage}\n`);
      return true;
    }

    // Проверка подключения к Twitch
    if (!this.client) {
      console.warn('[Twitch] ⚠️ Клиент не инициализирован');
      return false;
    }

    const readyState = this.client.readyState();
    if (readyState !== 'OPEN') {
      console.warn(`[Twitch] ⚠️ Клиент не подключен (состояние: ${readyState})`);
      return false;
    }

    // Проверка канала
    if (!config.twitch.channel) {
      console.error('[Twitch] ❌ Канал не указан в конфигурации');
      return false;
    }

    try {
      // Отправка сообщения в чат
      await this.client.say(config.twitch.channel, cleanedMessage);
      console.log(`💬 "${cleanedMessage}"`);
      return true;
    } catch (error) {
      // Обработка различных типов ошибок
      if (error.message?.includes('rate limit') || error.message?.includes('ratelimit')) {
        console.warn('[Twitch] ⚠️ Превышен лимит отправки сообщений, ждем...');
        // Можно добавить задержку и повторную попытку
        return false;
      } else if (error.message?.includes('timeout')) {
        console.warn('[Twitch] ⚠️ Таймаут при отправке сообщения');
        return false;
      } else if (error.message?.includes('banned') || error.message?.includes('ban')) {
        console.error('[Twitch] ❌ Бот забанен в чате');
        return false;
      } else {
        console.error('[Twitch] ❌ Ошибка отправки сообщения:', error.message || error);
        return false;
      }
    }
  }


  async disconnect() {
    if (this.client) {
      await this.client.disconnect();
      console.log('[Twitch] Отключен от чата');
    }
  }
}
