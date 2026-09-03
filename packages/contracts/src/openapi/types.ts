export interface OpenApiInfo {
  title: string;
  version: string;
  description?: string;
  license?: {
    name: string;
    url?: string;
  };
}

export interface OpenApiServer {
  url: string;
  description?: string;
}

export interface OpenApiSchemaProperty {
  type?: string | string[];
  description?: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  enum?: (string | number | boolean)[];
  items?: OpenApiSchemaProperty | { $ref: string };
  properties?: Record<string, OpenApiSchemaProperty | { $ref: string }>;
  required?: string[];
  additionalProperties?: boolean | OpenApiSchemaProperty | { $ref: string };
  default?: unknown;
}

export interface OpenApiSchema {
  type?: string | string[];
  title?: string;
  description?: string;
  properties?: Record<string, OpenApiSchemaProperty | { $ref: string }>;
  required?: string[];
  additionalProperties?: boolean | OpenApiSchemaProperty | { $ref: string };
  enum?: (string | number | boolean)[];
  items?: OpenApiSchemaProperty | { $ref: string };
}

export interface OpenApiMediaType {
  schema: OpenApiSchema | { $ref: string };
  example?: unknown;
}

export interface OpenApiRequestBody {
  description?: string;
  required?: boolean;
  content: Record<string, OpenApiMediaType>;
}

export interface OpenApiResponse {
  description: string;
  content?: Record<string, OpenApiMediaType>;
}

export interface OpenApiParameter {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
  schema: OpenApiSchemaProperty | { $ref: string };
}

export interface OpenApiOperation {
  summary: string;
  description?: string;
  operationId?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses: Record<string, OpenApiResponse>;
  security?: Record<string, string[]>[];
}

export interface OpenApiPathItem {
  summary?: string;
  description?: string;
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  put?: OpenApiOperation;
  delete?: OpenApiOperation;
  patch?: OpenApiOperation;
}

export interface OpenApiDocument {
  openapi: '3.1.0';
  info: OpenApiInfo;
  servers: OpenApiServer[];
  paths: Record<string, OpenApiPathItem>;
  components: {
    schemas: Record<string, OpenApiSchema>;
    securitySchemes?: Record<string, unknown>;
  };
}
