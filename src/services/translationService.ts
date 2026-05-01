export interface TranslationOptions {
  imageBuffer: string;
  textContent?: string;
  pageNumber: number;
  signal?: AbortSignal;
  part?: 'top' | 'bottom' | 'full';
  model?: TranslationEngine;
}

export interface TranslationService {
  translateMedicalPageStream(options: TranslationOptions): AsyncGenerator<string>;
  translateMedicalPage(options: TranslationOptions): Promise<string>;
  hasApiKey(): Promise<boolean>;
  summarizeContent?(content: string, type: 'page' | 'document' | 'chapter', signal?: AbortSignal): AsyncGenerator<string>;
}

export type TranslationEngine = 'gemini-3-flash-preview' | 'gemini-flash-lite-latest' | 'gemini-2.0-flash-exp';

export interface EngineConfig {
  apiKey?: string;
  modelName?: string;
}
