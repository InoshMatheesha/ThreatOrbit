/** What the app needs from any AI model: schema-shaped JSON text, and the models a key can use. */

export interface AiRequest {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
}

export interface AiModelInfo {
  id: string;
  name: string;
}

export interface AiClient {
  generate(request: AiRequest): Promise<{ text: string; model: string }>;
  /** Models this key may use. Also the cheapest way to check that a key works. */
  listModels?(): Promise<AiModelInfo[]>;
}

/** A failure the reader can be told about in plain words; the technical cause stays in the logs. */
export class AiClientError extends Error {
  constructor(
    readonly kind: 'refused' | 'busy' | 'rejected_key' | 'truncated' | 'bad_model' | 'failed',
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AiClientError';
  }
}
