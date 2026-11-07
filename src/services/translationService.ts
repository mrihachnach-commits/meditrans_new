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
  askNotebookQuestion?(documentContext: string, question: string, signal?: AbortSignal): AsyncGenerator<string>;
  testSingleKeyTranslation(apiKey: string, sampleText: string): Promise<{ success: boolean; resultText?: string; error?: string; latencyMs?: number }>;
  translateLayoutBlocks?(blocks: { id: string; text: string }[], signal?: AbortSignal): Promise<Record<string, string>>;
}

export type TranslationEngine = 
  | 'gemini-3.5-flash'
  | 'gemini-3.1-flash-lite'
  | 'gemini-3.8-flash'
  | 'gemini-3.6-flash' 
  | 'gemini-3-flash-preview' 
  | 'gemini-2.5-flash-lite'
  | string;

export interface EngineConfig {
  apiKey?: string;
  modelName?: string;
}
