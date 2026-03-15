# Implementation Plan: Model-Agnostic AI (Completed)

**Objective**: Decouple the AI pipeline from Ollama to support multiple providers, including Azure OpenAI, Google Gemini, Anthropic, and any OpenAI-compatible tool (LocalAI, vLLM, LM Studio).

## 1. Core Abstraction
- [x] **Provider Interface**: Defined `LLMProvider` interface in `server/services/llm/types.ts` with `generate` and `generateJSON` methods.
- [x] **Provider Factory**: Implemented a singleton factory in `server/services/llm/factory.ts` that instantiates providers based on the `AI_PROVIDER` environment variable.

## 2. Implemented Adapters
- [x] **Ollama**: Maintained existing local support via native `/api/generate` endpoint.
- [x] **Azure OpenAI**: Added support for Azure's specific REST structure and authentication, targeting `gpt-4o-mini`.
- [x] **OpenAI-Compatible**: Generic adapter for LocalAI, vLLM, LM Studio, GPT4All, xAI (Grok), Groq, and Mistral.
- [x] **Google Gemini**: Added support for the Google Generative Language API (`gemini-1.5-flash`).
- [x] **Anthropic**: Added support for the Claude Messages API (`claude-3-5-sonnet`).

## 3. Service Refactoring
- [x] **Translation Service**: Refactored `server/services/translate.ts` to use the unified provider factory.
- [x] **Insight Service**: Refactored `server/services/llm.ts` to use the unified provider factory for sentiment analysis and conversation summaries.

## 4. Configuration & Observability
- [x] **Environment Variables**: Updated `.env.example` with templates for all supported providers.
- [x] **Monitoring**: Instrumented all provider adapters with Prometheus timers (`ai_pipeline_duration_seconds`) and error counters (`ai_pipeline_errors_total`).
