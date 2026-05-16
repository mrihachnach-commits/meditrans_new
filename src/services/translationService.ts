export type TranslationStyle = 'standard' | 'simple' | 'academic' | 'expert' | 'creative';

export interface TranslationOptions {
  imageBuffer: string;
  textContent?: string;
  pageNumber: number;
  signal?: AbortSignal;
  part?: 'top' | 'bottom' | 'full';
  model?: TranslationEngine;
  style?: TranslationStyle;
}

export interface TranslationService {
  translateMedicalPageStream(options: TranslationOptions): AsyncGenerator<string>;
  translateMedicalPage(options: TranslationOptions): Promise<string>;
  hasApiKey(): Promise<boolean>;
  summarizeContent?(content: string, type: 'page' | 'document' | 'chapter', signal?: AbortSignal): AsyncGenerator<string>;
}

export type TranslationEngine = 'gemini-1.5-flash' | 'gemini-3-flash-preview' | 'gemini-flash-lite-latest';

export interface EngineConfig {
  apiKey?: string;
  modelName?: string;
}
