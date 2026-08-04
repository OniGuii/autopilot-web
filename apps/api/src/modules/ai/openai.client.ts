import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AI_SUGGEST_TIMEOUT_MS_DEFAULT } from '../async/async.constants';
import {
  AI_MAX_COMPLETION_TOKENS,
  AI_OPENAI_TIMEOUT_MS,
  AI_TEMPERATURE,
} from './ai.constants';

export type OpenAiChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type OpenAiChatResult = {
  content: string;
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  stub: boolean;
};

@Injectable()
export class OpenAiClient {
  private readonly logger = new Logger(OpenAiClient.name);

  constructor(private readonly config: ConfigService) {}

  getModel(): string {
    return this.config.get<string>('openai.model', 'gpt-4o-mini');
  }

  isConfigured(): boolean {
    const key = this.config.get<string>('openai.apiKey')?.trim();
    return Boolean(key);
  }

  /**
   * Chat Completions. In test env without key, returns a deterministic stub.
   * Outside test without key → 503.
   */
  async chatCompletion(
    messages: OpenAiChatMessage[],
  ): Promise<OpenAiChatResult> {
    const model = this.getModel();
    const apiKey = this.config.get<string>('openai.apiKey')?.trim();
    const nodeEnv = this.config.get<string>('nodeEnv', 'development');

    if (!apiKey) {
      if (nodeEnv === 'test') {
        return {
          stub: true,
          model: `${model}-stub`,
          content:
            'Olá! Obrigado pela mensagem. Posso te ajudar com mais detalhes sobre o que você procura?',
          usage: {
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
          },
        };
      }
      throw new ServiceUnavailableException('OpenAI API key is not configured');
    }

    const timeoutMs = this.config.get<number>(
      'async.aiSuggestTimeoutMs',
      AI_OPENAI_TIMEOUT_MS ?? AI_SUGGEST_TIMEOUT_MS_DEFAULT,
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: AI_TEMPERATURE,
            max_tokens: AI_MAX_COMPLETION_TOKENS,
          }),
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        const text = await response.text();
        this.logger.warn(
          `OpenAI error ${response.status}: ${text.slice(0, 300)}`,
        );
        throw new ServiceUnavailableException(
          `OpenAI request failed (${response.status})`,
        );
      }

      const data = (await response.json()) as {
        model?: string;
        choices?: Array<{ message?: { content?: string | null } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };

      const content = data.choices?.[0]?.message?.content?.trim() ?? '';
      return {
        stub: false,
        model: data.model ?? model,
        content,
        usage: {
          promptTokens: data.usage?.prompt_tokens ?? 0,
          completionTokens: data.usage?.completion_tokens ?? 0,
          totalTokens: data.usage?.total_tokens ?? 0,
        },
      };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      this.logger.warn(
        `OpenAI call failed: ${error instanceof Error ? error.message : error}`,
      );
      throw new ServiceUnavailableException('OpenAI request failed');
    } finally {
      clearTimeout(timer);
    }
  }
}
